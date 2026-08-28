# ---- frontend build ----
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- backend ----
FROM python:3.13-slim AS backend
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PGCONTROL_HOST=0.0.0.0 \
    PGCONTROL_PORT=7420 \
    PGCONTROL_DATA_DIR=/data \
    PGCONTROL_STATIC_DIR=/app/static
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY alembic ./alembic
RUN uv sync --frozen --no-dev
COPY --from=frontend /build/dist ./static
RUN useradd --system --uid 1000 --home /data pgcontrol && mkdir -p /data && chown pgcontrol /data
USER pgcontrol
VOLUME ["/data"]
EXPOSE 7420
HEALTHCHECK --interval=30s --timeout=5s CMD ["python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:7420/api/health')"]
CMD ["/app/.venv/bin/pgcontrol", "serve"]
