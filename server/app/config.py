from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ATLET_", env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./atlet.db"
    jwt_secret: str  # без дефолта: нет секрета — приложение не стартует
    jwt_algorithm: str = "HS256"
    access_ttl_minutes: int = 720
    cookie_secure: bool = False
    cors_origins: list[str] = ["http://127.0.0.1:8000", "http://localhost:8000"]
    cors_allow_regex: str = ""


@lru_cache
def get_settings() -> Settings:
    # обязательные поля pydantic-settings дочитывает из env/.env — pyright об этом не знает
    return Settings()  # pyright: ignore[reportCallIssue]
