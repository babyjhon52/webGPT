from datetime import datetime
from typing import Literal

from sqlmodel import SQLModel


class UserRegister(SQLModel):
    username: str
    email: str
    password: str


class UserRead(SQLModel):
    id: str
    username: str
    email: str
    created_at: datetime


class AuthResponse(SQLModel):
    message: str
    user: UserRead


class UserLogin(SQLModel):
    username: str
    password: str


class ModelRead(SQLModel):
    id: str
    openrouter_id: str
    display_name: str
    provider: str
    is_active: bool
    created_at: datetime


class MessageRead(SQLModel):
    id: str
    chat_id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime


class ChatRead(SQLModel):
    id: str
    user_id: str
    title: str
    model_id: str
    model_openrouter_id: str
    model_display_name: str
    system_prompt: str
    created_at: datetime
    updated_at: datetime
    messages: list[MessageRead] = []


class ChatCreate(SQLModel):
    user_id: str
    model_openrouter_id: str
    system_prompt: str = ""


class ChatUpdate(SQLModel):
    user_id: str
    title: str | None = None
    model_openrouter_id: str | None = None
    system_prompt: str | None = None


class MessageCreate(SQLModel):
    user_id: str
    content: str


class MessageCreateResponse(SQLModel):
    chat: ChatRead
    assistant_message: MessageRead | None = None
