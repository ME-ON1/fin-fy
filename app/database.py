from pathlib import Path

from sqlalchemy import NullPool, create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.secrets import secrets


def database_url() -> str:
    """Build the SQLAlchemy URL for the configured backend."""
    if secrets.DB_TYPE == "postgres":
        return (
            f"postgresql://{secrets.DB_USER}:{secrets.DB_PASS}"
            f"@localhost:{secrets.DB_PORT}/{secrets.DB_NAME}"
        )
    if secrets.DB_TYPE == "libsql":
        if not secrets.TURSO_URL:
            raise RuntimeError("DB_TYPE=libsql requires TURSO_URL in .env")
        return secrets.TURSO_URL
    return f"sqlite:///{Path(secrets.DB_PATH).resolve()}"


def _create_engine():
    if secrets.DB_TYPE == "sqlite":
        Path(secrets.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        engine = create_engine(
            database_url(),
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(engine, "connect")
        def _enable_fks(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

        return engine

    if secrets.DB_TYPE == "libsql":
        from app.libsql_dialect import register_dialects

        register_dialects()
        return create_engine(
            database_url(),
            connect_args={
                "auth_token": secrets.TURSO_AUTH_TOKEN,
                "check_same_thread": False,
            },
            # one connection per request, created/used in the request's own
            # thread (libSQL Hrana connections are thread-affine)
            poolclass=NullPool,
        )

    return create_engine(database_url())


engine = _create_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
