from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncEngine

from .application.undo import InMemoryUndoStore
from .config import Settings, get_settings
from .infrastructure.db import build_engine, build_session_factory
from .presentation.error_handlers import register_error_handlers
from .presentation.routers import (
    auth_router,
    bookings_router,
    report_router,
    sessions_router,
    state_router,
    users_router,
)


def create_app(settings: Settings | None = None, engine: AsyncEngine | None = None) -> FastAPI:
    resolved = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.engine = engine or build_engine(resolved.database_url)
        app.state.session_factory = build_session_factory(app.state.engine)
        app.state.undo = InMemoryUndoStore()
        yield
        await app.state.engine.dispose()

    app = FastAPI(title="АТЛЕТ API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved.cors_origins,
        allow_origin_regex=resolved.cors_allow_regex or None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)
    for router in (
        auth_router,
        state_router,
        sessions_router,
        bookings_router,
        users_router,
        report_router,
    ):
        app.include_router(router, prefix="/api")

    www = Path(__file__).resolve().parents[2] / "www"
    if (www / "assets").exists():
        app.mount("/", StaticFiles(directory=www, html=True), name="static")
    return app


app = create_app()
