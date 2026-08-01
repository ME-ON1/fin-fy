from pydantic_settings import BaseSettings, SettingsConfigDict


class Secrets(BaseSettings):
    DB_USER: str
    DB_PASS: str
    DB_PORT: int
    DB_NAME: str

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


secrets = Secrets()
