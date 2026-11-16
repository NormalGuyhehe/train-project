from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .repositories import SqlBookingRepo, SqlSessionRepo, SqlUserRepo


class SqlAlchemyUnitOfWork:
    def __init__(self, factory: async_sessionmaker[AsyncSession]) -> None:
        self._factory = factory

    async def __aenter__(self) -> "SqlAlchemyUnitOfWork":
        self._session = self._factory()
        self.users = SqlUserRepo(self._session)
        self.sessions = SqlSessionRepo(self._session)
        self.bookings = SqlBookingRepo(self._session)
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._session.rollback()
        await self._session.close()

    async def commit(self) -> None:
        await self._session.commit()

    async def rollback(self) -> None:
        await self._session.rollback()
