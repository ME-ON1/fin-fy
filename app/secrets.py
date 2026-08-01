from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Secrets(BaseSettings):
    # Which database backend: sqlite | postgres | libsql (Turso)
    DB_TYPE: str = "sqlite"

    # sqlite
    DB_PATH: str = "data/fin_fy.db"

    # postgres
    DB_USER: str = "user"
    DB_PASS: str = ""
    DB_PORT: int = 5544
    DB_NAME: str = "fin_fy"

    # libsql / Turso
    TURSO_URL: str | None = None       # e.g. libsql://finfy-<org>.turso.io
    TURSO_AUTH_TOKEN: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )


secrets = Secrets()
