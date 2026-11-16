import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from .config import get_settings
from .domain.entities import Booking, Kind, Role, User, WorkoutSession
from .infrastructure.db import build_engine, build_session_factory
from .infrastructure.security import Argon2Hasher
from .infrastructure.uow import SqlAlchemyUnitOfWork

KINDS = list(Kind)
TIMES = ["08:00", "10:00", "12:00", "17:00", "19:00", "20:30"]
DAY_SLOTS = [[0, 1, 3, 4], [1, 2, 4, 5], [0, 2, 3, 5], [0, 1, 2, 4]]
MEMBERS = [
    "Аружан Бекова",
    "Никита Волков",
    "Елена Цой",
    "Тимур Алиев",
    "Ольга Пак",
    "Адия Нур",
    "Павел Ким",
    "Мария Ли",
]
TITLES = {
    Kind.strength: ("Силовая тренировка", "Full Body Strength", "Дмитрий Ким", "Зал 1", 60),
    Kind.cardio: ("Кардио-интервалы", "Функциональное кардио", "Марат Абдрахманов", "Зал 1", 45),
    Kind.yoga: ("Утренняя йога", "Йога-релакс", "Айгерим Сапарова", "Зал 2", 75),
    Kind.crossfit: ("CrossFit WOD", "Круговая тренировка", "Сергей Ли", "Зал 1", 50),
    Kind.stretch: ("Стретчинг", "Мобильность и растяжка", "Алина Ким", "Зал 2", 60),
}


async def main() -> None:
    engine = build_engine(get_settings().database_url)
    try:
        uow = SqlAlchemyUnitOfWork(build_session_factory(engine))
        hasher = Argon2Hasher()
        async with uow:
            if await uow.users.all():
                print("База уже заполнена — пропуск.")
                return
            now = datetime.now(UTC)
            admin = User(
                uuid4().hex, "Администратор", "admin@atlet.kz", hasher.hash("admin123"), Role.admin
            )
            client = User(
                uuid4().hex,
                "Александр Петров",
                "client@atlet.kz",
                hasher.hash("client123"),
                Role.client,
            )
            members = [
                User(
                    uuid4().hex,
                    name,
                    f"member{i + 1}@atlet.kz",
                    hasher.hash("client123"),
                    Role.client,
                )
                for i, name in enumerate(MEMBERS)
            ]
            for u in [admin, client, *members]:
                await uow.users.add(u)

            sessions: list[WorkoutSession] = []
            for d in range(7):
                for i, slot in enumerate(DAY_SLOTS[d % 4]):
                    kind = KINDS[(d + i) % len(KINDS)]
                    t1, t2, trainer, room, dur = TITLES[kind]
                    h, m = map(int, TIMES[slot].split(":"))
                    start = (now + timedelta(days=d)).replace(
                        hour=h, minute=m, second=0, microsecond=0
                    )
                    full = d == 1 and i == 0
                    capacity = 8 if full else 8 + ((d * 3 + i * 5) % 13)
                    s = WorkoutSession(
                        uuid4().hex,
                        (t1, t2)[(d + i) % 2],
                        kind,
                        trainer,
                        room,
                        start,
                        dur,
                        capacity,
                    )
                    sessions.append(s)
                    await uow.sessions.add(s)
                    taken = capacity if full else (d * 5 + i * 3) % 9
                    for k in range(min(taken, capacity)):
                        await uow.bookings.add(Booking(uuid4().hex, members[k].id, s.id, now))

            past = WorkoutSession(
                uuid4().hex,
                "Силовая тренировка",
                Kind.strength,
                "Дмитрий Ким",
                "Зал 1",
                now - timedelta(days=1),
                60,
                12,
            )
            await uow.sessions.add(past)
            await uow.bookings.add(Booking(uuid4().hex, client.id, past.id, now))
            await uow.bookings.add(Booking(uuid4().hex, client.id, sessions[0].id, now))
            await uow.commit()
        print("Сид загружен: admin@atlet.kz / admin123, client@atlet.kz / client123")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
