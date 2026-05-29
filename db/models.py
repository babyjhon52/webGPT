from datetime import datetime, timezone
from uuid import uuid4

from sqlmodel import Field, Relationship, SQLModel


def new_id() -> str:
    return str(uuid4())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: str = Field(default_factory=new_id, primary_key=True)
    username: str = Field(index=True, unique=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    created_at: datetime = Field(default_factory=now_utc)

    chats: list["Chat"] = Relationship(back_populates="user")


class AuthSession(SQLModel, table=True):
    __tablename__ = "auth_sessions"

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    token_hash: str = Field(index=True, unique=True)
    created_at: datetime = Field(default_factory=now_utc)
    expires_at: datetime = Field(index=True)


class Model(SQLModel, table=True):
    __tablename__ = "models"

    id: str = Field(default_factory=new_id, primary_key=True)
    openrouter_id: str = Field(index=True, unique=True)
    display_name: str
    provider: str
    is_active: bool = True
    created_at: datetime = Field(default_factory=now_utc)

    chats: list["Chat"] = Relationship(back_populates="model")


class Chat(SQLModel, table=True):
    __tablename__ = "chats"

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="users.id")
    title: str = "Новый чат"
    model_id: str = Field(foreign_key="models.id")
    system_prompt: str = ""
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)

    user: User = Relationship(back_populates="chats")
    model: Model = Relationship(back_populates="chats")
    messages: list["Message"] = Relationship(back_populates="chat")


class Message(SQLModel, table=True):
    __tablename__ = "messages"

    id: str = Field(default_factory=new_id, primary_key=True)
    chat_id: str = Field(foreign_key="chats.id")
    role: str
    content: str
    created_at: datetime = Field(default_factory=now_utc)

    chat: Chat = Relationship(back_populates="messages")
