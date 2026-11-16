from typing import Annotated

from fastapi import APIRouter, Depends, Response
from fastapi.responses import PlainTextResponse

from ..application.services import (
    AuthService,
    BookingService,
    ReportService,
    SessionService,
    UserService,
)
from ..config import Settings, get_settings
from ..domain.entities import Booking, Role, SessionDraft, User, WorkoutSession
from .deps import (
    COOKIE,
    current_user,
    get_accounts,
    get_auth,
    get_booking,
    get_catalog,
    get_reports,
    require_admin,
)
from .schemas import (
    BookingIn,
    BookingOut,
    DeletedOut,
    LoginIn,
    RegisterIn,
    SessionIn,
    SessionOut,
    UndoIn,
    UserOut,
    UserPatch,
)

auth_router = APIRouter(prefix="/auth", tags=["auth"])
sessions_router = APIRouter(prefix="/sessions", tags=["sessions"])
bookings_router = APIRouter(prefix="/bookings", tags=["bookings"])
users_router = APIRouter(prefix="/users", tags=["users"])
report_router = APIRouter(prefix="/report", tags=["report"])
state_router = APIRouter(tags=["state"])


def _user_out(u: User) -> UserOut:
    return UserOut(id=u.id, name=u.name, email=u.email, role=u.role)


def _session_out(s: WorkoutSession) -> SessionOut:
    return SessionOut(
        id=s.id,
        title=s.title,
        kind=s.kind,
        trainer=s.trainer,
        room=s.room,
        starts_at=s.starts_at.isoformat(),
        duration_min=s.duration_min,
        capacity=s.capacity,
    )


def _booking_out(b: Booking) -> BookingOut:
    return BookingOut(
        id=b.id, user_id=b.user_id, session_id=b.session_id, created_at=b.created_at.isoformat()
    )


def _draft(body: SessionIn) -> SessionDraft:
    return SessionDraft(
        title=body.title,
        kind=body.kind,
        trainer=body.trainer,
        room=body.room,
        date=body.date,
        time=body.time,
        duration_min=body.duration_min,
        capacity=body.capacity,
    )


def _set_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=settings.access_ttl_minutes * 60,
        path="/",
    )


@auth_router.post("/register", response_model=UserOut)
async def register(
    body: RegisterIn,
    response: Response,
    auth: Annotated[AuthService, Depends(get_auth)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserOut:
    user, token = await auth.register(body.name, body.email, body.password)
    _set_cookie(response, token, settings)
    return _user_out(user)


@auth_router.post("/login", response_model=UserOut)
async def login(
    body: LoginIn,
    response: Response,
    auth: Annotated[AuthService, Depends(get_auth)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserOut:
    user, token = await auth.login(body.email, body.password)
    _set_cookie(response, token, settings)
    return _user_out(user)


@auth_router.post("/logout", status_code=204)
async def logout(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


@auth_router.get("/me", response_model=UserOut)
async def me(user: Annotated[User, Depends(current_user)]) -> UserOut:
    return _user_out(user)


@state_router.get("/state")
async def state(
    user: Annotated[User, Depends(current_user)],
    catalog: Annotated[SessionService, Depends(get_catalog)],
    booking: Annotated[BookingService, Depends(get_booking)],
    accounts: Annotated[UserService, Depends(get_accounts)],
) -> dict:
    sessions = [_session_out(s) for s in await catalog.list()]
    source = await booking.all() if user.role is Role.admin else await booking.of_user(user.id)
    bookings = [_booking_out(b) for b in source]
    users = [_user_out(u) for u in await accounts.list()] if user.role is Role.admin else None
    return {"sessions": sessions, "bookings": bookings, "users": users}


@sessions_router.get("", response_model=list[SessionOut])
async def list_sessions(
    catalog: Annotated[SessionService, Depends(get_catalog)],
) -> list[SessionOut]:
    return [_session_out(s) for s in await catalog.list()]


@sessions_router.post("", response_model=SessionOut, status_code=201)
async def create_session(
    body: SessionIn,
    _: Annotated[User, Depends(require_admin)],
    catalog: Annotated[SessionService, Depends(get_catalog)],
) -> SessionOut:
    return _session_out(await catalog.create(_draft(body)))


@sessions_router.put("/{session_id}", response_model=SessionOut)
async def update_session(
    session_id: str,
    body: SessionIn,
    _: Annotated[User, Depends(require_admin)],
    catalog: Annotated[SessionService, Depends(get_catalog)],
) -> SessionOut:
    return _session_out(await catalog.update(session_id, _draft(body)))


@sessions_router.delete("/{session_id}", response_model=DeletedOut)
async def delete_session(
    session_id: str,
    actor: Annotated[User, Depends(require_admin)],
    catalog: Annotated[SessionService, Depends(get_catalog)],
) -> DeletedOut:
    return DeletedOut(undo_token=await catalog.remove(session_id, actor.id))


@sessions_router.post("/restore", status_code=204)
async def restore_session(
    body: UndoIn,
    actor: Annotated[User, Depends(require_admin)],
    catalog: Annotated[SessionService, Depends(get_catalog)],
) -> None:
    await catalog.restore(body.undo_token, actor.id)


@bookings_router.get("/me", response_model=list[BookingOut])
async def my_bookings(
    user: Annotated[User, Depends(current_user)],
    booking: Annotated[BookingService, Depends(get_booking)],
) -> list[BookingOut]:
    return [_booking_out(b) for b in await booking.of_user(user.id)]


@bookings_router.post("", response_model=BookingOut, status_code=201)
async def book(
    body: BookingIn,
    user: Annotated[User, Depends(current_user)],
    booking: Annotated[BookingService, Depends(get_booking)],
) -> BookingOut:
    return _booking_out(await booking.book(user.id, body.session_id))


@bookings_router.delete("/{booking_id}", response_model=BookingOut)
async def cancel(
    booking_id: str,
    user: Annotated[User, Depends(current_user)],
    booking: Annotated[BookingService, Depends(get_booking)],
) -> BookingOut:
    return _booking_out(await booking.cancel(user, booking_id))


@users_router.get("", response_model=list[UserOut])
async def list_users(
    _: Annotated[User, Depends(require_admin)],
    accounts: Annotated[UserService, Depends(get_accounts)],
) -> list[UserOut]:
    return [_user_out(u) for u in await accounts.list()]


@users_router.put("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    body: UserPatch,
    _: Annotated[User, Depends(require_admin)],
    accounts: Annotated[UserService, Depends(get_accounts)],
) -> UserOut:
    return _user_out(await accounts.update(user_id, body.name, body.email, body.role))


@users_router.delete("/{user_id}", response_model=DeletedOut)
async def delete_user(
    user_id: str,
    actor: Annotated[User, Depends(require_admin)],
    accounts: Annotated[UserService, Depends(get_accounts)],
) -> DeletedOut:
    return DeletedOut(undo_token=await accounts.remove(actor, user_id))


@users_router.post("/restore", status_code=204)
async def restore_user(
    body: UndoIn,
    actor: Annotated[User, Depends(require_admin)],
    accounts: Annotated[UserService, Depends(get_accounts)],
) -> None:
    await accounts.restore(body.undo_token, actor.id)


@report_router.get("")
async def report(
    _: Annotated[User, Depends(require_admin)],
    reports: Annotated[ReportService, Depends(get_reports)],
) -> dict:
    data = await reports.build()
    data["rows"] = [{**r, "session": _session_out(r["session"])} for r in data["rows"]]
    return data


@report_router.get(".csv", response_class=PlainTextResponse)
async def report_csv(
    _: Annotated[User, Depends(require_admin)],
    reports: Annotated[ReportService, Depends(get_reports)],
) -> PlainTextResponse:
    data = await reports.build()
    lines = ["Тренировка;Тип;Записано;Вместимость;Заполняемость %"]
    lines += [
        f'"{r["session"].title}";{r["session"].kind};{r["booked"]};'
        f"{r['session'].capacity};{r['occupancy']}"
        for r in data["rows"]
    ]
    return PlainTextResponse("\ufeff" + "\r\n".join(lines), media_type="text/csv; charset=utf-8")
