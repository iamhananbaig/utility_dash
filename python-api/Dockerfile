FROM python:3.13-slim

RUN addgroup --gid 1001 app && \
    adduser --uid 1001 --gid 1001 --disabled-password --gecos "" app

COPY --from=ghcr.io/astral-sh/uv:0.11.16 /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev --no-cache

COPY --chown=app:app . .

USER app

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
