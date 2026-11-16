from collections.abc import AsyncIterator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.infrastructure.db import create_all
from app.infrastructure.uow import SqlAlchemyUnitOfWork
from app.main import create_app


@pytest.fixture
def settings() -> Settings:
    return Settings(
        jwt_secret="test-secret", database_url="sqlite+aiosqlite://", cookie_secure=False
    )


@pytest.fixture
async def engine(settings: Settings) -> AsyncIterator[AsyncEngine]:
    eng = create_async_engine(settings.database_url, poolclass=StaticPool)
    await create_all(eng)
    yield eng
    await eng.dispose()


@pytest.fixture
async def app(settings: Settings, engine: AsyncEngine) -> AsyncIterator[FastAPI]:
    application = create_app(settings, engine=engine)
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
def uow(engine: AsyncEngine) -> SqlAlchemyUnitOfWork:
    return SqlAlchemyUnitOfWork(async_sessionmaker(engine, expire_on_commit=False))


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def register_user(client: AsyncClient):
    async def _register(email: str = "a@test.kz", name: str = "Тест Тестов") -> dict:
        res = await client.post(
            "/api/auth/register", json={"name": name, "email": email, "password": "secret1"}
        )
        assert res.status_code == 200
        return res.json()

    return _register
