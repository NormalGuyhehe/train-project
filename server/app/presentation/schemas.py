from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from ..domain.entities import Kind, Role


class Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class RegisterIn(Camel):
    name: str
    email: str
    password: str


class LoginIn(Camel):
    email: str
    password: str


class UserOut(Camel):
    id: str
    name: str
    email: str
    role: Role


class SessionIn(Camel):
    title: str
    kind: Kind
    trainer: str
    room: str
    date: str
    time: str
    duration_min: int
    capacity: int


class SessionOut(Camel):
    id: str
    title: str
    kind: Kind
    trainer: str
    room: str
    starts_at: str
    duration_min: int
    capacity: int


class BookingIn(Camel):
    session_id: str


class BookingOut(Camel):
    id: str
    user_id: str
    session_id: str
    created_at: str


class UserPatch(Camel):
    name: str
    email: str
    role: Role


class UndoIn(Camel):
    undo_token: str


class DeletedOut(Camel):
    undo_token: str
