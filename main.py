from pathlib import Path
from datetime import timedelta
import os
from dotenv import load_dotenv
from openai import AsyncOpenAI, OpenAIError
from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from db import db, models
from db.schemas import (
    AuthResponse,
    ChatCreate,
    ChatRead,
    ChatUpdate,
    MessageCreate,
    MessageCreateResponse,
    MessageRead,
    ModelRead,
    UserLogin,
    UserRead,
    UserRegister,
)
from db.security import (
    create_session_token,
    hash_password,
    hash_session_token,
    verify_password,
)

load_dotenv()

app = FastAPI()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY") or os.getenv("ROUTER_API_KEY")

client = AsyncOpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=OPENROUTER_API_KEY or "missing-api-key",
    timeout=30.0,
    max_retries=2,
)

FRONT_DIR = Path(__file__).parent / "front"
DEFAULT_MODEL_OPENROUTER_ID = "qwen/qwen3.6-plus"
SESSION_COOKIE_NAME = "bmstugpt_session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14
MODEL_SEEDS = [
    {
        "openrouter_id": "qwen/qwen3.6-plus",
        "display_name": "qwen3.6-plus",
        "provider": "Qwen",
    },
    {
        "openrouter_id": "deepseek/deepseek-v4-flash",
        "display_name": "deepseek-v4-flash",
        "provider": "DeepSeek",
    },
]


@app.on_event("startup")
def on_startup():
    db.create_db_and_tables()
    with Session(db.engine) as session:
        seed_models(session)


def seed_models(session: Session) -> None:
    for model_data in MODEL_SEEDS:
        existing_model = session.exec(
            select(models.Model).where(
                models.Model.openrouter_id == model_data["openrouter_id"]
            )
        ).first()
        if existing_model:
            continue

        session.add(models.Model(**model_data))

    session.commit()


def is_secure_request(request: Request) -> bool:
    return request.url.scheme == "https"


def set_session_cookie(request: Request, response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=is_secure_request(request),
        samesite="lax",
        path="/",
    )


def clear_session_cookie(request: Request, response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        secure=is_secure_request(request),
        samesite="lax",
        path="/",
    )


def create_auth_session(user: models.User, session: Session) -> str:
    token = create_session_token()
    auth_session = models.AuthSession(
        user_id=user.id,
        token_hash=hash_session_token(token),
        expires_at=models.now_utc() + timedelta(seconds=SESSION_MAX_AGE_SECONDS),
    )
    session.add(auth_session)
    session.commit()
    return token


def get_current_user(
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    session: Session = Depends(db.get_session),
) -> models.User:
    if not session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Войдите в аккаунт.",
        )

    auth_session = session.exec(
        select(models.AuthSession).where(
            models.AuthSession.token_hash == hash_session_token(session_token),
            models.AuthSession.expires_at > models.now_utc(),
        )
    ).first()
    if not auth_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Сессия истекла. Войдите снова.",
        )

    user = session.get(models.User, auth_session.user_id)
    if not user:
        session.delete(auth_session)
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Сессия недействительна. Войдите снова.",
        )

    return user


def get_model_by_openrouter_id(
    openrouter_id: str,
    session: Session,
) -> models.Model:
    model = session.exec(
        select(models.Model).where(
            models.Model.openrouter_id == openrouter_id,
            models.Model.is_active == True,
        )
    ).first()
    if not model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Модель не найдена.",
        )

    return model


def get_default_model(session: Session) -> models.Model:
    return get_model_by_openrouter_id(DEFAULT_MODEL_OPENROUTER_ID, session)


def get_chat_or_404(chat_id: str, user_id: str, session: Session) -> models.Chat:
    chat = session.exec(
        select(models.Chat).where(
            models.Chat.id == chat_id,
            models.Chat.user_id == user_id,
        )
    ).first()
    if not chat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Чат не найден.",
        )

    return chat


def to_message_read(message: models.Message) -> MessageRead:
    return MessageRead(
        id=message.id,
        chat_id=message.chat_id,
        role=message.role,
        content=message.content,
        created_at=message.created_at,
    )


def to_chat_read(chat: models.Chat, session: Session) -> ChatRead:
    model = session.get(models.Model, chat.model_id)
    messages = session.exec(
        select(models.Message)
        .where(models.Message.chat_id == chat.id)
        .order_by(models.Message.created_at)
    ).all()

    if not model:
        model = get_default_model(session)

    return ChatRead(
        id=chat.id,
        user_id=chat.user_id,
        title=chat.title,
        model_id=chat.model_id,
        model_openrouter_id=model.openrouter_id,
        model_display_name=model.display_name,
        system_prompt=chat.system_prompt,
        created_at=chat.created_at,
        updated_at=chat.updated_at,
        messages=[to_message_read(message) for message in messages],
    )


async def get_assistant_answer(chat: models.Chat, session: Session) -> str:
    if not OPENROUTER_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Добавьте OPENROUTER_API_KEY или ROUTER_API_KEY в .env.",
        )

    model = session.get(models.Model, chat.model_id)
    if not model:
        model = get_default_model(session)

    history = session.exec(
        select(models.Message)
        .where(models.Message.chat_id == chat.id)
        .order_by(models.Message.created_at)
    ).all()

    openrouter_messages = []
    if chat.system_prompt.strip():
        openrouter_messages.append(
            {"role": "system", "content": chat.system_prompt.strip()}
        )

    for message in history:
        openrouter_messages.append(
            {
                "role": message.role,
                "content": message.content,
            }
        )

    try:
        response = await client.chat.completions.create(
            model=model.openrouter_id,
            messages=openrouter_messages,
        )
    except OpenAIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenRouter не ответил: {exc}",
        ) from exc

    answer = response.choices[0].message.content if response.choices else None
    if not answer:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Модель вернула пустой ответ.",
        )

    return answer


@app.get("/api/v1/ping")
def ping():
    return {"status": "ok"}


@app.post("/api/v1/auth/register")
def register_user(
    user_data: UserRegister,
    request: Request,
    response: Response,
    session: Session = Depends(db.get_session),
) -> AuthResponse:
    username = user_data.username.strip()
    email = user_data.email.strip().lower()
    password = user_data.password

    if not username or not email or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Заполните логин, почту и пароль.",
        )

    if len(password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пароль должен быть не короче 6 символов.",
        )

    existing_user = session.exec(
        select(models.User).where(
            (models.User.username == username) | (models.User.email == email)
        )
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Пользователь с таким логином или почтой уже существует.",
        )

    user = models.User(
        username=username,
        email=email,
        password_hash=hash_password(password),
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    token = create_auth_session(user, session)
    set_session_cookie(request, response, token)

    return AuthResponse(
        message="user registered",
        user=UserRead.model_validate(user),
    )


@app.post("/api/v1/auth/login")
def login_user(
    user_data: UserLogin,
    request: Request,
    response: Response,
    session: Session = Depends(db.get_session),
) -> AuthResponse:
    username = user_data.username.strip()
    password = user_data.password

    user = session.exec(
        select(models.User).where(models.User.username == username)
    ).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль.",
        )

    token = create_auth_session(user, session)
    set_session_cookie(request, response, token)

    return AuthResponse(
        message="user logged in",
        user=UserRead.model_validate(user),
    )


@app.get("/api/v1/auth/me")
def get_current_user_profile(
    current_user: models.User = Depends(get_current_user),
) -> UserRead:
    return UserRead.model_validate(current_user)


@app.post("/api/v1/auth/logout")
def logout_user(
    request: Request,
    response: Response,
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    session: Session = Depends(db.get_session),
) -> dict[str, str]:
    if session_token:
        auth_session = session.exec(
            select(models.AuthSession).where(
                models.AuthSession.token_hash == hash_session_token(session_token)
            )
        ).first()
        if auth_session:
            session.delete(auth_session)
            session.commit()

    clear_session_cookie(request, response)
    return {"message": "user logged out"}


@app.get("/api/v1/models")
def get_models(session: Session = Depends(db.get_session)) -> list[ModelRead]:
    db_models = session.exec(
        select(models.Model)
        .where(models.Model.is_active == True)
        .order_by(models.Model.display_name)
    ).all()
    return [ModelRead.model_validate(model) for model in db_models]


@app.get("/api/v1/chats")
def get_chats(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
) -> list[ChatRead]:
    chats = session.exec(
        select(models.Chat)
        .where(models.Chat.user_id == current_user.id)
        .order_by(models.Chat.updated_at.desc())
    ).all()
    return [to_chat_read(chat, session) for chat in chats]


@app.post("/api/v1/chats")
def create_chat(
    chat_data: ChatCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
) -> ChatRead:
    model = get_model_by_openrouter_id(chat_data.model_openrouter_id, session)
    chat = models.Chat(
        user_id=current_user.id,
        model_id=model.id,
        system_prompt=chat_data.system_prompt.strip(),
    )
    session.add(chat)
    session.commit()
    session.refresh(chat)

    greeting = models.Message(
        chat_id=chat.id,
        role="assistant",
        content=f"Привет, {current_user.username}! Я готов к диалогу.",
    )
    session.add(greeting)
    session.commit()
    session.refresh(chat)

    return to_chat_read(chat, session)


@app.patch("/api/v1/chats/{chat_id}")
def update_chat(
    chat_id: str,
    chat_data: ChatUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
) -> ChatRead:
    chat = get_chat_or_404(chat_id, current_user.id, session)

    if chat_data.title is not None:
        chat.title = chat_data.title.strip() or "Новый чат"

    if chat_data.system_prompt is not None:
        chat.system_prompt = chat_data.system_prompt.strip()

    if chat_data.model_openrouter_id is not None:
        model = get_model_by_openrouter_id(chat_data.model_openrouter_id, session)
        chat.model_id = model.id

    chat.updated_at = models.now_utc()
    session.add(chat)
    session.commit()
    session.refresh(chat)

    return to_chat_read(chat, session)


@app.delete("/api/v1/chats/{chat_id}")
def delete_chat(
    chat_id: str,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
) -> dict[str, str]:
    chat = get_chat_or_404(chat_id, current_user.id, session)
    messages = session.exec(
        select(models.Message).where(models.Message.chat_id == chat.id)
    ).all()

    for message in messages:
        session.delete(message)

    session.delete(chat)
    session.commit()

    return {"message": "chat deleted"}


@app.post("/api/v1/chats/{chat_id}/messages")
async def send_message(
    chat_id: str,
    message_data: MessageCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(db.get_session),
) -> MessageCreateResponse:
    chat = get_chat_or_404(chat_id, current_user.id, session)
    content = message_data.content.strip()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Сообщение не может быть пустым.",
        )

    user_message = models.Message(
        chat_id=chat.id,
        role="user",
        content=content,
    )
    session.add(user_message)

    if chat.title == "Новый чат":
        chat.title = content[:42] + "..." if len(content) > 42 else content

    chat.updated_at = models.now_utc()
    session.add(chat)
    session.commit()
    session.refresh(chat)

    assistant_content = await get_assistant_answer(chat, session)
    assistant_message = models.Message(
        chat_id=chat.id,
        role="assistant",
        content=assistant_content,
    )
    session.add(assistant_message)

    chat.updated_at = models.now_utc()
    session.add(chat)
    session.commit()
    session.refresh(chat)
    session.refresh(assistant_message)

    return MessageCreateResponse(
        chat=to_chat_read(chat, session),
        assistant_message=to_message_read(assistant_message),
    )


app.mount("/", StaticFiles(directory=FRONT_DIR, html=True), name="front")
