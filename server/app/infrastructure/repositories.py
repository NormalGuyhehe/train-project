from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..domain.entities import Booking, Kind, Role, User, WorkoutSession
from .models import BookingModel, SessionModel, UserModel


def _user(m: UserModel) -> User:
    return User(m.id, m.name, m.email, m.password_hash, Role(m.role))


def _session(m: SessionModel) -> WorkoutSession:
    return WorkoutSession(
        m.id, m.title, Kind(m.kind), m.trainer, m.room, m.starts_at, m.duration_min, m.capacity
    )


def _booking(m: BookingModel) -> Booking:
    return Booking(m.id, m.user_id, m.session_id, m.created_at)


class SqlUserRepo:
    def __init__(self, s: AsyncSession) -> None:
        self._s = s

    async def all(self) -> list[User]:
        return [_user(m) for m in (await self._s.scalars(select(UserModel))).all()]

    async def by_id(self, user_id: str) -> User | None:
        m = await self._s.get(UserModel, user_id)
        return _user(m) if m else None

    async def by_email(self, email: str) -> User | None:
        m = await self._s.scalar(select(UserModel).where(UserModel.email == email))
        return _user(m) if m else None

    async def add(self, u: User) -> None:
        self._s.add(
            UserModel(
                id=u.id,
                name=u.name,
                email=u.email,
                password_hash=u.password_hash,
                role=u.role.value,
            )
        )

    async def update(self, u: User) -> None:
        m = await self._s.get(UserModel, u.id)
        if m:
            m.name, m.email, m.role = u.name, u.email, u.role.value

    async def delete(self, user_id: str) -> None:
        await self._s.execute(delete(UserModel).where(UserModel.id == user_id))


class SqlSessionRepo:
    def __init__(self, s: AsyncSession) -> None:
        self._s = s

    async def all(self) -> list[WorkoutSession]:
        return [_session(m) for m in (await self._s.scalars(select(SessionModel))).all()]

    async def by_id(self, session_id: str) -> WorkoutSession | None:
        m = await self._s.get(SessionModel, session_id)
        return _session(m) if m else None

    async def lock_by_id(self, session_id: str) -> WorkoutSession | None:
        # FOR UPDATE на Postgres; SQLite сериализует записи транзакциями
        m = await self._s.scalar(
            select(SessionModel).where(SessionModel.id == session_id).with_for_update()
        )
        return _session(m) if m else None

    async def add(self, s: WorkoutSession) -> None:
        self._s.add(
            SessionModel(
                id=s.id,
                title=s.title,
                kind=s.kind.value,
                trainer=s.trainer,
                room=s.room,
                starts_at=s.starts_at,
                duration_min=s.duration_min,
                capacity=s.capacity,
            )
        )

    async def update(self, s: WorkoutSession) -> None:
        m = await self._s.get(SessionModel, s.id)
        if m:
            m.title, m.kind, m.trainer, m.room = s.title, s.kind.value, s.trainer, s.room
            m.starts_at, m.duration_min, m.capacity = s.starts_at, s.duration_min, s.capacity

    async def delete(self, session_id: str) -> None:
        await self._s.execute(delete(SessionModel).where(SessionModel.id == session_id))


class SqlBookingRepo:
    def __init__(self, s: AsyncSession) -> None:
        self._s = s

    async def all(self) -> list[Booking]:
        return [_booking(m) for m in (await self._s.scalars(select(BookingModel))).all()]

    async def by_id(self, booking_id: str) -> Booking | None:
        m = await self._s.get(BookingModel, booking_id)
        return _booking(m) if m else None

    async def find(self, user_id: str, session_id: str) -> Booking | None:
        m = await self._s.scalar(
            select(BookingModel).where(
                BookingModel.user_id == user_id, BookingModel.session_id == session_id
            )
        )
        return _booking(m) if m else None

    async def of_user(self, user_id: str) -> list[Booking]:
        return [
            _booking(m)
            for m in (
                await self._s.scalars(select(BookingModel).where(BookingModel.user_id == user_id))
            ).all()
        ]

    async def of_session(self, session_id: str) -> list[Booking]:
        return [
            _booking(m)
            for m in (
                await self._s.scalars(
                    select(BookingModel).where(BookingModel.session_id == session_id)
                )
            ).all()
        ]

    async def count_by_session(self) -> dict[str, int]:
        rows = await self._s.execute(
            select(BookingModel.session_id, func.count()).group_by(BookingModel.session_id)
        )
        return dict(rows.all())

    async def count_by_user(self) -> dict[str, int]:
        rows = await self._s.execute(
            select(BookingModel.user_id, func.count()).group_by(BookingModel.user_id)
        )
        return dict(rows.all())

    async def add(self, b: Booking) -> None:
        self._s.add(
            BookingModel(
                id=b.id, user_id=b.user_id, session_id=b.session_id, created_at=b.created_at
            )
        )

    async def delete(self, booking_id: str) -> None:
        await self._s.execute(delete(BookingModel).where(BookingModel.id == booking_id))

    async def delete_many(self, ids: list[str]) -> None:
        if ids:
            await self._s.execute(delete(BookingModel).where(BookingModel.id.in_(ids)))
