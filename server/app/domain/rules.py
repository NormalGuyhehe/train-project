import re
from datetime import datetime

from .entities import SessionDraft, WorkoutSession
from .errors import (
    AlreadyBooked,
    CapacityBelowBooked,
    SessionFull,
    SessionStarted,
    Validation,
)

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


def draft_start(draft: SessionDraft) -> datetime:
    try:
        return datetime.fromisoformat(f"{draft.date}T{draft.time}").astimezone()
    except ValueError as exc:
        raise Validation("Некорректные дата или время") from exc


def check_bookable(session: WorkoutSession, booked: int, already: bool, now: datetime) -> None:
    if session.starts_at <= now:
        raise SessionStarted("Тренировка уже началась или завершилась")
    if already:
        raise AlreadyBooked("Вы уже записаны на эту тренировку")
    if booked >= session.capacity:
        raise SessionFull("Свободных мест не осталось")


def validate_registration(name: str, email: str, password: str) -> None:
    if len(name.strip()) < 2:
        raise Validation("Укажите имя (минимум 2 символа)")
    if not EMAIL_RE.match(email.strip()):
        raise Validation("Некорректный email")
    if len(password) < 6:
        raise Validation("Пароль — минимум 6 символов")


def validate_draft(draft: SessionDraft, now: datetime, *, is_new: bool, booked: int) -> None:
    if not draft.title.strip() or not draft.trainer.strip() or not draft.room.strip():
        raise Validation("Заполните название, тренера и зал")
    start = draft_start(draft)
    if is_new and start <= now:
        raise Validation("Новая тренировка должна быть в будущем")
    if not 15 <= draft.duration_min <= 180:
        raise Validation("Длительность — от 15 до 180 минут")
    if not 1 <= draft.capacity <= 100:
        raise Validation("Вместимость — от 1 до 100 мест")
    if draft.capacity < booked:
        raise CapacityBelowBooked(f"Уже записано {booked} — меньшую вместимость задать нельзя")
