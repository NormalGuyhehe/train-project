from typing import Annotated

from fastapi import Cookie, Depends, Request

from ..application.services import (
    AuthService,
    BookingService,
    ReportService,
    SessionService,
    UserService,
)
from ..application.undo import UndoStore
from ..config import Settings, get_settings
from ..domain.entities import Role, User
from ..domain.errors import Forbidden, Unauthorized
from ..infrastructure.security import Argon2Hasher, JwtTokens
from ..infrastructure.uow import SqlAlchemyUnitOfWork

COOKIE = "atlet_token"


def get_uow(request: Request) -> SqlAlchemyUnitOfWork:
    return SqlAlchemyUnitOfWork(request.app.state.session_factory)


def get_undo(request: Request) -> UndoStore:
    return request.app.state.undo


def get_tokens(settings: Annotated[Settings, Depends(get_settings)]) -> JwtTokens:
    return JwtTokens(settings.jwt_secret, settings.jwt_algorithm, settings.access_ttl_minutes)


def get_auth(
    uow: Annotated[SqlAlchemyUnitOfWork, Depends(get_uow)],
    tokens: Annotated[JwtTokens, Depends(get_tokens)],
) -> AuthService:
    return AuthService(lambda: uow, Argon2Hasher(), tokens)


def get_booking(uow: Annotated[SqlAlchemyUnitOfWork, Depends(get_uow)]) -> BookingService:
    return BookingService(lambda: uow)


def get_catalog(
    uow: Annotated[SqlAlchemyUnitOfWork, Depends(get_uow)],
    undo: Annotated[UndoStore, Depends(get_undo)],
) -> SessionService:
    return SessionService(lambda: uow, undo)


def get_accounts(
    uow: Annotated[SqlAlchemyUnitOfWork, Depends(get_uow)],
    undo: Annotated[UndoStore, Depends(get_undo)],
) -> UserService:
    return UserService(lambda: uow, undo)


def get_reports(uow: Annotated[SqlAlchemyUnitOfWork, Depends(get_uow)]) -> ReportService:
    return ReportService(lambda: uow)


async def current_user(
    auth: Annotated[AuthService, Depends(get_auth)],
    atlet_token: Annotated[str | None, Cookie()] = None,
) -> User:
    if not atlet_token:
        raise Unauthorized("Требуется вход")
    return await auth.me(atlet_token)


async def require_admin(user: Annotated[User, Depends(current_user)]) -> User:
    if user.role is not Role.admin:
        raise Forbidden("Недостаточно прав")
    return user
