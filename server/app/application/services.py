from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.exc import IntegrityError

from ..domain import rules
from ..domain.entities import (
    Booking,
    Kind,
    Role,
    SessionDraft,
    SessionSnapshot,
    User,
    UserSnapshot,
    WorkoutSession,
)
from ..domain.errors import (
    AlreadyBooked,
    EmailTaken,
    Forbidden,
    NotFound,
    SelfDelete,
    Unauthorized,
    Validation,
)
from .ports import PasswordHasher, TokenService, UowFactory
from .undo import UndoStore


def _now() -> datetime:
    return datetime.now(UTC)


class AuthService:
    def __init__(self, uow: UowFactory, hasher: PasswordHasher, tokens: TokenService) -> None:
        self._uow, self._hasher, self._tokens = uow, hasher, tokens

    async def register(self, name: str, email: str, password: str) -> tuple[User, str]:
        rules.validate_registration(name, email, password)
        email = email.strip().lower()
        async with self._uow() as uow:
            if await uow.users.by_email(email):
                raise EmailTaken("Этот email уже занят")
            user = User(uuid4().hex, name.strip(), email, self._hasher.hash(password), Role.client)
            await uow.users.add(user)
            await uow.commit()
        return user, self._tokens.issue(user.id)

    async def login(self, email: str, password: str) -> tuple[User, str]:
        async with self._uow() as uow:
            user = await uow.users.by_email(email.strip().lower())
        if not user or not self._hasher.verify(password, user.password_hash):
            raise Unauthorized("Неверный email или пароль")
        return user, self._tokens.issue(user.id)

    async def me(self, token: str) -> User:
        user_id = self._tokens.decode(token)
        async with self._uow() as uow:
            user = await uow.users.by_id(user_id)
        if not user:
            raise Unauthorized("Сессия недействительна")
        return user


class BookingService:
    def __init__(self, uow: UowFactory) -> None:
        self._uow = uow

    async def book(self, user_id: str, session_id: str) -> Booking:
        async with self._uow() as uow:
            session = await uow.sessions.lock_by_id(session_id)
            if not session:
                raise NotFound("тренировка")
            booked = len(await uow.bookings.of_session(session_id))
            already = await uow.bookings.find(user_id, session_id) is not None
            rules.check_bookable(session, booked, already, _now())
            booking = Booking(uuid4().hex, user_id, session_id, _now())
            await uow.bookings.add(booking)
            try:
                await uow.commit()
            except IntegrityError as exc:  # unique(user_id, session_id) — гонка двух запросов
                raise AlreadyBooked("Вы уже записаны на эту тренировку") from exc
        return booking

    async def all(self) -> list[Booking]:
        async with self._uow() as uow:
            return await uow.bookings.all()

    async def cancel(self, user: User, booking_id: str) -> Booking:
        async with self._uow() as uow:
            booking = await uow.bookings.by_id(booking_id)
            if not booking:
                raise NotFound("запись")
            if booking.user_id != user.id and user.role is not Role.admin:
                raise Forbidden("Нельзя отменить чужую запись")
            await uow.bookings.delete(booking_id)
            await uow.commit()
        return booking

    async def of_user(self, user_id: str) -> list[Booking]:
        async with self._uow() as uow:
            return await uow.bookings.of_user(user_id)


class SessionService:
    def __init__(self, uow: UowFactory, undo: UndoStore) -> None:
        self._uow, self._undo = uow, undo

    async def list(self) -> list[WorkoutSession]:
        async with self._uow() as uow:
            return sorted(await uow.sessions.all(), key=lambda s: s.starts_at)

    async def create(self, draft: SessionDraft) -> WorkoutSession:
        rules.validate_draft(draft, _now(), is_new=True, booked=0)
        session = self._from_draft(uuid4().hex, draft)
        async with self._uow() as uow:
            await uow.sessions.add(session)
            await uow.commit()
        return session

    async def update(self, session_id: str, draft: SessionDraft) -> WorkoutSession:
        async with self._uow() as uow:
            if not await uow.sessions.by_id(session_id):
                raise NotFound("тренировка")
            booked = len(await uow.bookings.of_session(session_id))
            rules.validate_draft(draft, _now(), is_new=False, booked=booked)
            session = self._from_draft(session_id, draft)
            await uow.sessions.update(session)
            await uow.commit()
        return session

    async def remove(self, session_id: str, actor_id: str) -> str:
        async with self._uow() as uow:
            session = await uow.sessions.by_id(session_id)
            if not session:
                raise NotFound("тренировка")
            bookings = tuple(await uow.bookings.of_session(session_id))
            await uow.bookings.delete_many([b.id for b in bookings])
            await uow.sessions.delete(session_id)
            await uow.commit()
        return self._undo.put(SessionSnapshot(session, bookings), actor_id)

    async def restore(self, token: str, actor_id: str) -> None:
        snapshot = self._undo.pop(token, actor_id)
        if not isinstance(snapshot, SessionSnapshot):
            raise NotFound("операция для отмены")
        async with self._uow() as uow:
            if await uow.sessions.by_id(snapshot.session.id):
                await uow.sessions.update(snapshot.session)
            else:
                await uow.sessions.add(snapshot.session)
            for booking in snapshot.bookings:
                if not await uow.bookings.by_id(booking.id):
                    await uow.bookings.add(booking)
            await uow.commit()

    @staticmethod
    def _from_draft(session_id: str, draft: SessionDraft) -> WorkoutSession:
        return WorkoutSession(
            id=session_id,
            title=draft.title.strip(),
            kind=draft.kind,
            trainer=draft.trainer.strip(),
            room=draft.room.strip(),
            starts_at=rules.draft_start(draft),
            duration_min=draft.duration_min,
            capacity=draft.capacity,
        )


class UserService:
    def __init__(self, uow: UowFactory, undo: UndoStore) -> None:
        self._uow, self._undo = uow, undo

    async def list(self) -> list[User]:
        async with self._uow() as uow:
            return await uow.users.all()

    async def update(self, user_id: str, name: str, email: str, role: Role) -> User:
        if len(name.strip()) < 2:
            raise Validation("Укажите имя (минимум 2 символа)")
        email = email.strip().lower()
        if not rules.EMAIL_RE.match(email):
            raise Validation("Некорректный email")
        async with self._uow() as uow:
            user = await uow.users.by_id(user_id)
            if not user:
                raise NotFound("пользователь")
            existing = await uow.users.by_email(email)
            if existing and existing.id != user_id:
                raise EmailTaken("Этот email уже занят")
            updated = User(user.id, name.strip(), email, user.password_hash, role)
            await uow.users.update(updated)
            await uow.commit()
        return updated

    async def remove(self, actor: User, user_id: str) -> str:
        if actor.id == user_id:
            raise SelfDelete("Нельзя удалить собственную учётную запись")
        async with self._uow() as uow:
            user = await uow.users.by_id(user_id)
            if not user:
                raise NotFound("пользователь")
            bookings = tuple(await uow.bookings.of_user(user_id))
            await uow.bookings.delete_many([b.id for b in bookings])
            await uow.users.delete(user_id)
            await uow.commit()
        return self._undo.put(UserSnapshot(user, bookings), actor.id)

    async def restore(self, token: str, actor_id: str) -> None:
        snapshot = self._undo.pop(token, actor_id)
        if not isinstance(snapshot, UserSnapshot):
            raise NotFound("операция для отмены")
        async with self._uow() as uow:
            if not await uow.users.by_id(snapshot.user.id):
                await uow.users.add(snapshot.user)
            for booking in snapshot.bookings:
                if not await uow.bookings.by_id(booking.id):
                    await uow.bookings.add(booking)
            await uow.commit()


class ReportService:
    def __init__(self, uow: UowFactory) -> None:
        self._uow = uow

    async def build(self) -> dict:
        async with self._uow() as uow:
            sessions = sorted(await uow.sessions.all(), key=lambda s: s.starts_at)
            counts = await uow.bookings.count_by_session()
            users = await uow.users.all()
        rows = [
            {
                "session": s,
                "booked": counts.get(s.id, 0),
                "occupancy": round(counts.get(s.id, 0) / s.capacity * 100) if s.capacity else 0,
            }
            for s in sessions
        ]
        capacity = sum(s.capacity for s in sessions)
        total = sum(counts.values())
        by_kind: dict[Kind, int] = {}
        for s in sessions:
            by_kind[s.kind] = by_kind.get(s.kind, 0) + counts.get(s.id, 0)
        top = max(by_kind, key=lambda k: by_kind[k]) if by_kind else None
        return {
            "rows": rows,
            "totalSessions": len(sessions),
            "totalBookings": total,
            "activeClients": sum(1 for u in users if u.role is Role.client),
            "occupancy": round(total / capacity * 100) if capacity else 0,
            "topKind": top,
        }
