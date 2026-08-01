from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.secrets import secrets

DATABASE_URL = (
    f"postgresql://{secrets.DB_USER}:{secrets.DB_PASS}"
    f"@localhost:{secrets.DB_PORT}/{secrets.DB_NAME}"
)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
