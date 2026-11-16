from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum


class Role(StrEnum):
    client = "client"
    admin = "admin"


class Kind(StrEnum):
    strength = "strength"
    cardio = "cardio"
    yoga = "yoga"
    crossfit = "crossfit"
    stretch = "stretch"


@dataclass(frozen=True)
class User:
    id: str
    name: str
    email: str
    password_hash: str
    role: Role


@dataclass(frozen=True)
class WorkoutSession:
    id: str
    title: str
    kind: Kind
    trainer: str
    room: str
    starts_at: datetime
    duration_min: int
    capacity: int


@dataclass(frozen=True)
class Booking:
    id: str
    user_id: str
    session_id: str
    created_at: datetime


@dataclass(frozen=True)
class SessionDraft:
    title: str
    kind: Kind
    trainer: str
    room: str
    date: str
    time: str
    duration_min: int
    capacity: int


@dataclass(frozen=True)
class SessionSnapshot:
    session: WorkoutSession
    bookings: tuple[Booking, ...]


@dataclass(frozen=True)
class UserSnapshot:
    user: User
    bookings: tuple[Booking, ...]
