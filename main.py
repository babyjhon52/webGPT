from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from db import db, models

app = FastAPI()

FRONT_DIR = Path(__file__).parent / "front"

@app.on_event("startup")
def on_startup():
    db.create_db_and_tables()

@app.get("/api/v1/ping")
def ping():
    return {"status": "ok"}


@app.post("/api/v1/auth/register")
def register_user():
    
    return {"message": "user registered"}


@app.post("/api/v1/auth/login")
def login_user():
    return {"message": "user logged in"}


@app.get("/api/v1/chats")
def get_chats():
    return []


@app.post("/api/v1/chats")
def create_chat():
    return {"message": "chat created"}


@app.post("/api/v1/chats/{chat_id}/messages")
def send_message(chat_id: str):
    return {"answer": "Ответ модели"}


app.mount("/", StaticFiles(directory=FRONT_DIR, html=True), name="front")