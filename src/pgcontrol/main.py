import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from pgcontrol import __version__
from pgcontrol.api import auth, profiles
from pgcontrol.bootstrap import ensure_admin_user
from pgcontrol.config import get_settings
from pgcontrol.db.migrate import upgrade_to_head
from pgcontrol.db.session import dispose_engine
from pgcontrol.pg.connection import PoolManager
from pgcontrol.security.crypto import SecretBox

log = logging.getLogger("pgcontrol")

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    await asyncio.to_thread(upgrade_to_head)
    await ensure_admin_user()
    app.state.secret_box = SecretBox(settings.secret_key)
    app.state.pools = PoolManager()
    log.info("PgControl %s listening on http://%s:%s", __version__, settings.host, settings.port)
    yield
    await app.state.pools.close_all()
    await dispose_engine()


def create_app() -> FastAPI:
    app = FastAPI(title="PgControl", version=__version__, lifespan=lifespan)

    @app.middleware("http")
    async def csrf_guard(request: Request, call_next):
        # Cookie-based auth: reject cross-site state-changing requests.
        if request.method not in SAFE_METHODS and request.url.path.startswith("/api/"):
            fetch_site = request.headers.get("sec-fetch-site")
            if fetch_site is not None:
                if fetch_site not in ("same-origin", "none"):
                    return JSONResponse({"detail": "Cross-site request rejected"}, 403)
            else:
                origin = request.headers.get("origin")
                host = request.headers.get("host")
                if origin and host and origin.split("://", 1)[-1] != host:
                    return JSONResponse({"detail": "Cross-site request rejected"}, 403)
        return await call_next(request)

    @app.get("/api/health", tags=["meta"])
    async def health():
        return {"status": "ok", "version": __version__}

    app.include_router(auth.router)
    app.include_router(profiles.router)

    static_dir = get_settings().resolve_static_dir()
    if static_dir is not None:
        _mount_spa(app, static_dir)
    else:
        log.warning("No frontend build found; serving API only")

    return app


def _mount_spa(app: FastAPI, static_dir: Path) -> None:
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")
    index = static_dir / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        candidate = static_dir / path
        if (
            path
            and candidate.is_file()
            and candidate.resolve().is_relative_to(static_dir.resolve())
        ):
            return FileResponse(candidate)
        return FileResponse(index)


app = create_app()
