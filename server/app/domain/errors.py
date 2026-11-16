class DomainError(Exception):
    code = "validation"
    status = 400

    def __init__(self, message: str = "") -> None:
        super().__init__(message or self.code)
        self.message = message or self.code


class Validation(DomainError):
    code = "validation"


class Unauthorized(DomainError):
    code = "forbidden"
    status = 401


class Forbidden(DomainError):
    code = "forbidden"
    status = 403


class NotFound(DomainError):
    code = "not-found"
    status = 404


class InvalidCredentials(DomainError):
    code = "invalid-credentials"
    status = 401


class EmailTaken(DomainError):
    code = "email-taken"
    status = 409


class SessionFull(DomainError):
    code = "session-full"
    status = 409


class AlreadyBooked(DomainError):
    code = "already-booked"
    status = 409


class SessionStarted(DomainError):
    code = "session-started"
    status = 409


class CapacityBelowBooked(DomainError):
    code = "capacity-below-booked"
    status = 409


class SelfDelete(DomainError):
    code = "self-delete"
