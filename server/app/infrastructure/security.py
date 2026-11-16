from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from ..domain.errors import Unauthorized

_hash = PasswordHash.recommended()  # argon2id


class Argon2Hasher:
    def hash(self, plain: str) -> str:
        return _hash.hash(plain)

    def verify(self, plain: str, stored: str) -> bool:
        try:
            return _hash.verify(plain, stored)
        except Exception:
            return False


class JwtTokens:
    def __init__(self, secret: str, algorithm: str, ttl_minutes: int) -> None:
        self._secret, self._algorithm, self._ttl = secret, algorithm, ttl_minutes

    def issue(self, user_id: str) -> str:
        now = datetime.now(UTC)
        payload = {"sub": user_id, "iat": now, "exp": now + timedelta(minutes=self._ttl)}
        return jwt.encode(payload, self._secret, algorithm=self._algorithm)

    def decode(self, token: str) -> str:
        try:
            payload = jwt.decode(token, self._secret, algorithms=[self._algorithm])
            return payload["sub"]
        except (jwt.PyJWTError, KeyError) as exc:
            raise Unauthorized("Сессия недействительна") from exc
