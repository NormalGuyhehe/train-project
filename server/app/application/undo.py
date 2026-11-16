from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from uuid import uuid4

from ..domain.entities import SessionSnapshot, UserSnapshot
from ..domain.errors import NotFound

Snapshot = SessionSnapshot | UserSnapshot


class UndoStore(Protocol):
    def put(self, snapshot: Snapshot, owner_id: str) -> str: ...
    def pop(self, token: str, owner_id: str) -> Snapshot: ...


@dataclass
class _Entry:
    snapshot: Snapshot
    owner_id: str
    expires_at: datetime


class InMemoryUndoStore:
    """Undo живёт на сервере: клиент получает только токен.

    Ограничение: один процесс. Для нескольких воркеров — Redis или soft-delete.
    """

    def __init__(self, ttl: timedelta = timedelta(minutes=5)) -> None:
        self._ttl = ttl
        self._entries: dict[str, _Entry] = {}

    def put(self, snapshot: Snapshot, owner_id: str) -> str:
        self._evict()
        token = uuid4().hex
        self._entries[token] = _Entry(snapshot, owner_id, datetime.now(UTC) + self._ttl)
        return token

    def pop(self, token: str, owner_id: str) -> Snapshot:
        self._evict()
        entry = self._entries.pop(token, None)
        if entry is None or entry.owner_id != owner_id:
            raise NotFound("операция для отмены")
        return entry.snapshot

    def _evict(self) -> None:
        now = datetime.now(UTC)
        for token in [t for t, e in self._entries.items() if e.expires_at <= now]:
            del self._entries[token]
