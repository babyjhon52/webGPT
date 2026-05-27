# BMSTUGPT

Мини проект для курса по вебу: веб-клиент для общения с AI-моделями через OpenRouter.

## Что есть

- frontend на  HTML/CSS/JS;
- backend на FastAPI;
- регистрация и вход пользователей;
- создание, обновление и удаление чатов;
- отправка сообщений в OpenRouter;
- выбор модели: `qwen/qwen3.6-plus`, `deepseek/deepseek-v4-flash`;
- системный промпт для чата;
- хранение данных в SQLite.

## Настройка

Создайте `.env` в корне проекта:

```env
OPENROUTER_API_KEY=your_openrouter_api_key
```

Также поддерживается переменная `ROUTER_API_KEY`.

## Локальный запуск

```bash
uv sync
uv run uvicorn main:app --reload
```

Приложение будет доступно по адресу:

```text
http://127.0.0.1:8000
```

## Запуск в Docker

```bash
docker build -t bmstugpt .
docker run --rm --env-file .env -p 8443:8443 -v bmstugpt-data:/data bmstugpt
```

Приложение будет доступно по адресу:

```text
https://localhost:8443
```

## Тесты

```bash
uv run pytest
```
