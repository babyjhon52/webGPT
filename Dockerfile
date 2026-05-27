FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_SYSTEM_PYTHON=0
ENV UV_LINK_MODE=copy
ENV DATABASE_URL=sqlite:////data/app.db

WORKDIR /app

COPY pyproject.toml uv.lock ./

RUN pip install --no-cache-dir uv \
    && uv sync --frozen --no-dev --no-install-project \
    && mkdir -p /data

COPY main.py ./
COPY db ./db
COPY front ./front
COPY certs ./certs

EXPOSE 8443

CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8443", "--ssl-keyfile", "certs/key.pem", "--ssl-certfile", "certs/cert.pem"]
