FROM ghcr.io/astral-sh/uv:0.10.9 AS uv

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_SYSTEM_PYTHON=0
ENV UV_LINK_MODE=copy
ENV UV_HTTP_TIMEOUT=120
ENV DATABASE_URL=sqlite:////data/app.db

WORKDIR /app

COPY --from=uv /uv /uvx /usr/local/bin/
COPY pyproject.toml uv.lock ./

RUN uv sync --frozen --no-dev --no-install-project \
    && mkdir -p /data

COPY main.py ./
COPY db ./db
COPY front ./front
COPY certs ./certs

EXPOSE 8443

CMD ["uv", "run", "hypercorn", "main:app", "--bind", "0.0.0.0:8443", "--certfile", "certs/cert.pem", "--keyfile", "certs/key.pem"]
