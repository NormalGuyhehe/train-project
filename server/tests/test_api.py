from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.domain.entities import Kind, Role, WorkoutSession
from app.infrastructure.uow import SqlAlchemyUnitOfWork


@pytest.fixture
async def session_id(uow: SqlAlchemyUnitOfWork) -> str:
    session = WorkoutSession(
        uuid4().hex,
        "Йога",
        Kind.yoga,
        "Ким",
        "Зал 2",
        datetime.now(UTC) + timedelta(hours=2),
        60,
        1,
    )
    async with uow:
        await uow.sessions.add(session)
        await uow.commit()
    return session.id


async def promote(uow: SqlAlchemyUnitOfWork, email: str) -> None:
    async with uow:
        user = await uow.users.by_email(email)
        assert user is not None
        await uow.users.update(replace(user, role=Role.admin))
        await uow.commit()


async def login(client: AsyncClient, email: str) -> None:
    res = await client.post("/api/auth/login", json={"email": email, "password": "secret1"})
    assert res.status_code == 200


async def test_register_login_me(client: AsyncClient, register_user) -> None:
    await register_user()
    assert (await client.get("/api/auth/me")).json()["email"] == "a@test.kz"
    await client.post("/api/auth/logout")
    assert (await client.get("/api/auth/me")).status_code == 401
    bad = await client.post("/api/auth/login", json={"email": "a@test.kz", "password": "wrong"})
    assert bad.status_code == 401
    await login(client, "a@test.kz")


async def test_duplicate_email(client: AsyncClient, register_user) -> None:
    await register_user()
    res = await client.post(
        "/api/auth/register",
        json={"name": "Другой", "email": "a@test.kz", "password": "secret1"},
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "email-taken"


async def test_booking_rules(client: AsyncClient, register_user, session_id: str) -> None:
    await register_user()
    assert (await client.post("/api/bookings", json={"sessionId": session_id})).status_code == 201
    again = await client.post("/api/bookings", json={"sessionId": session_id})
    assert again.json()["error"]["code"] == "already-booked"
    await register_user("b@test.kz")
    full = await client.post("/api/bookings", json={"sessionId": session_id})
    assert full.json()["error"]["code"] == "session-full"


async def test_admin_guard(client: AsyncClient, register_user) -> None:
    await register_user()
    res = await client.post(
        "/api/sessions",
        json={
            "title": "X",
            "kind": "yoga",
            "trainer": "Ким",
            "room": "1",
            "date": "2030-01-01",
            "time": "10:00",
            "durationMin": 60,
            "capacity": 5,
        },
    )
    assert res.status_code == 403


async def test_session_undo_is_server_side(
    client: AsyncClient, register_user, uow: SqlAlchemyUnitOfWork, session_id: str
) -> None:
    await register_user("admin@test.kz")
    await promote(uow, "admin@test.kz")
    await login(client, "admin@test.kz")

    deleted = await client.delete(f"/api/sessions/{session_id}")
    assert deleted.status_code == 200
    token = deleted.json()["undoToken"]
    assert "session" not in deleted.json()  # снапшот не утекает клиенту

    ok = await client.post("/api/sessions/restore", json={"undoToken": token})
    assert ok.status_code == 204
    twice = await client.post("/api/sessions/restore", json={"undoToken": token})
    assert twice.status_code == 404


async def test_user_undo_preserves_password(
    client: AsyncClient, register_user, uow: SqlAlchemyUnitOfWork
) -> None:
    victim = await register_user("victim@test.kz")
    await register_user("admin@test.kz")
    await promote(uow, "admin@test.kz")
    await login(client, "admin@test.kz")

    deleted = await client.delete(f"/api/users/{victim['id']}")
    assert deleted.status_code == 200
    restored = await client.post(
        "/api/users/restore", json={"undoToken": deleted.json()["undoToken"]}
    )
    assert restored.status_code == 204
    await login(client, "victim@test.kz")  # хеш пароля пережил удаление


async def test_state_requires_auth(client: AsyncClient) -> None:
    assert (await client.get("/api/state")).status_code == 401
