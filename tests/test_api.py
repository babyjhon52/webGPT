import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
from db import db, models
from db.security import hash_password, verify_password


@pytest.fixture()
def test_app():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        main.seed_models(session)

    def get_test_session():
        with Session(engine) as session:
            yield session

    main.app.dependency_overrides[db.get_session] = get_test_session
    client = TestClient(main.app)

    yield client, engine

    main.app.dependency_overrides.clear()


def register_user(client: TestClient, username: str = "ilya") -> dict:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": username,
            "email": f"{username}@example.com",
            "password": "secret123",
        },
    )
    assert response.status_code == 200
    assert main.SESSION_COOKIE_NAME in client.cookies
    return response.json()["user"]


def test_ping_and_models(test_app):
    client, _ = test_app

    assert client.get("/api/v1/ping").json() == {"status": "ok"}

    response = client.get("/api/v1/models")
    assert response.status_code == 200
    model_ids = {model["openrouter_id"] for model in response.json()}
    assert model_ids == {"qwen/qwen3.6-plus", "deepseek/deepseek-v4-flash"}


def test_register_login_and_security(test_app):
    client, _ = test_app

    short_password = client.post(
        "/api/v1/auth/register",
        json={"username": "bad", "email": "bad@example.com", "password": "12"},
    )
    assert short_password.status_code == 400

    user = register_user(client)
    assert user["username"] == "ilya"
    assert "password" not in user
    assert "password_hash" not in user

    me_response = client.get("/api/v1/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["id"] == user["id"]

    duplicate = client.post(
        "/api/v1/auth/register",
        json={
            "username": "ilya",
            "email": "copy@example.com",
            "password": "secret123",
        },
    )
    assert duplicate.status_code == 409

    wrong_login = client.post(
        "/api/v1/auth/login",
        json={"username": "ilya", "password": "wrong"},
    )
    assert wrong_login.status_code == 401

    good_login = client.post(
        "/api/v1/auth/login",
        json={"username": "ilya", "password": "secret123"},
    )
    assert good_login.status_code == 200
    assert good_login.json()["user"]["id"] == user["id"]

    logout_response = client.post("/api/v1/auth/logout")
    assert logout_response.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401

    password_hash = hash_password("secret123")
    assert password_hash != "secret123"
    assert verify_password("secret123", password_hash)
    assert not verify_password("wrong", password_hash)
    assert not verify_password("secret123", "broken-hash")


def test_chat_crud_and_message_flow(test_app, monkeypatch):
    client, _ = test_app
    register_user(client)

    create_response = client.post(
        "/api/v1/chats",
        json={
            "model_openrouter_id": "qwen/qwen3.6-plus",
            "system_prompt": "Отвечай кратко.",
        },
    )
    assert create_response.status_code == 200
    chat = create_response.json()
    assert chat["title"] == "Новый чат"
    assert chat["messages"][0]["role"] == "assistant"

    list_response = client.get("/api/v1/chats")
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1

    patch_response = client.patch(
        f"/api/v1/chats/{chat['id']}",
        json={
            "title": "   ",
            "model_openrouter_id": "deepseek/deepseek-v4-flash",
            "system_prompt": "Пиши без воды.",
        },
    )
    assert patch_response.status_code == 200
    patched_chat = patch_response.json()
    assert patched_chat["title"] == "Новый чат"
    assert patched_chat["model_openrouter_id"] == "deepseek/deepseek-v4-flash"
    assert patched_chat["system_prompt"] == "Пиши без воды."

    empty_message = client.post(
        f"/api/v1/chats/{chat['id']}/messages",
        json={"content": "   "},
    )
    assert empty_message.status_code == 400

    async def fake_answer(chat_obj, session):
        saved_user_message = session.exec(
            select(models.Message).where(
                models.Message.chat_id == chat_obj.id,
                models.Message.role == "user",
            )
        ).first()
        assert saved_user_message.content == "Расскажи про FastAPI"
        return "FastAPI нужен для API на Python."

    monkeypatch.setattr(main, "get_assistant_answer", fake_answer)

    message_response = client.post(
        f"/api/v1/chats/{chat['id']}/messages",
        json={"content": "Расскажи про FastAPI"},
    )
    assert message_response.status_code == 200
    data = message_response.json()
    assert data["assistant_message"]["content"] == "FastAPI нужен для API на Python."
    assert data["chat"]["title"] == "Расскажи про FastAPI"
    assert [message["role"] for message in data["chat"]["messages"]] == [
        "assistant",
        "user",
        "assistant",
    ]

    delete_response = client.delete(f"/api/v1/chats/{chat['id']}")
    assert delete_response.status_code == 200
    assert delete_response.json() == {"message": "chat deleted"}
    assert client.get("/api/v1/chats").json() == []


def test_not_found_and_invalid_model_paths(test_app):
    client, _ = test_app
    user = register_user(client)

    anonymous_client = TestClient(main.app)
    unauthorized_chats = anonymous_client.get("/api/v1/chats")
    assert unauthorized_chats.status_code == 401

    invalid_model = client.post(
        "/api/v1/chats",
        json={
            "model_openrouter_id": "unknown/model",
            "system_prompt": "",
        },
    )
    assert invalid_model.status_code == 404

    chat = client.post(
        "/api/v1/chats",
        json={
            "model_openrouter_id": "qwen/qwen3.6-plus",
            "system_prompt": "",
        },
    ).json()

    other_client = TestClient(main.app)
    other = register_user(other_client, "other")

    spoofed_create = other_client.post(
        "/api/v1/chats",
        json={
            "user_id": user["id"],
            "model_openrouter_id": "qwen/qwen3.6-plus",
            "system_prompt": "",
        },
    )
    assert spoofed_create.status_code == 200
    assert spoofed_create.json()["user_id"] == other["id"]
    assert spoofed_create.json()["id"] not in {
        item["id"] for item in client.get("/api/v1/chats").json()
    }

    wrong_owner_patch = client.patch(
        "/api/v1/chats/missing-chat",
        json={"title": "Чужой чат"},
    )
    assert wrong_owner_patch.status_code == 404

    wrong_owner_patch = other_client.patch(
        f"/api/v1/chats/{chat['id']}",
        json={"title": "Чужой чат"},
    )
    assert wrong_owner_patch.status_code == 404

    wrong_owner_delete = other_client.delete(f"/api/v1/chats/{chat['id']}")
    assert wrong_owner_delete.status_code == 404


def test_get_assistant_answer_success_and_errors(test_app, monkeypatch):
    _, engine = test_app

    class FakeCompletions:
        def __init__(self):
            self.model = None
            self.messages = None

        async def create(self, model, messages):
            self.model = model
            self.messages = messages
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(content="Ответ из OpenRouter")
                    )
                ]
            )

    fake_completions = FakeCompletions()
    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=fake_completions)
    )
    monkeypatch.setattr(main, "client", fake_client)
    monkeypatch.setattr(main, "OPENROUTER_API_KEY", "test-key")

    with Session(engine) as session:
        model = session.exec(
            select(models.Model).where(
                models.Model.openrouter_id == "qwen/qwen3.6-plus"
            )
        ).first()
        user = models.User(
            username="direct",
            email="direct@example.com",
            password_hash=hash_password("secret123"),
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        chat = models.Chat(
            user_id=user.id,
            model_id=model.id,
            system_prompt="Отвечай по-русски.",
        )
        session.add(chat)
        session.commit()
        session.refresh(chat)

        session.add(
            models.Message(chat_id=chat.id, role="user", content="Привет")
        )
        session.commit()

        answer = asyncio.run(main.get_assistant_answer(chat, session))
        assert answer == "Ответ из OpenRouter"
        assert fake_completions.model == "qwen/qwen3.6-plus"
        assert fake_completions.messages[0] == {
            "role": "system",
            "content": "Отвечай по-русски.",
        }
        assert fake_completions.messages[-1] == {
            "role": "user",
            "content": "Привет",
        }

        monkeypatch.setattr(main, "OPENROUTER_API_KEY", "")
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(main.get_assistant_answer(chat, session))
        assert exc_info.value.status_code == 500
