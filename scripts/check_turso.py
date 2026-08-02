"""Verify the fin-fy database connection before deploying.

Usage:
    .venv/bin/python scripts/check_turso.py

Reads DB_TYPE / TURSO_URL / TURSO_AUTH_TOKEN from .env and runs a round-trip:
connect -> SELECT 1 -> create/drop a temp table -> report.
Run this on the server BEFORE `alembic upgrade head`.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import database_url  # noqa: E402
from app.secrets import secrets  # noqa: E402


def main() -> int:
    print(f"DB_TYPE      : {secrets.DB_TYPE}")
    url = database_url()
    print(f"URL          : {url if secrets.DB_TYPE != 'libsql' or not secrets.TURSO_AUTH_TOKEN else url + ' (token set)'}")

    if secrets.DB_TYPE == "libsql":
        if not secrets.TURSO_URL:
            print("✗ TURSO_URL is empty — set it in .env (e.g. libsql://finfy-<org>.turso.io)")
            return 1
        is_cloud = "turso.io" in secrets.TURSO_URL or secrets.TURSO_URL.startswith("https://")
        if is_cloud and not secrets.TURSO_AUTH_TOKEN:
            print("✗ TURSO_AUTH_TOKEN is empty — run: turso db tokens create finfy")
            return 1

    try:
        from sqlalchemy import text
        from app.database import engine

        with engine.connect() as conn:
            v = conn.execute(text("SELECT sqlite_version()")).scalar()
            print(f"✓ connected, sqlite/libsql version: {v}")
            conn.execute(text("CREATE TABLE IF NOT EXISTS _finfy_check (id INTEGER)"))
            conn.execute(text("INSERT INTO _finfy_check VALUES (1)"))
            n = conn.execute(text("SELECT COUNT(*) FROM _finfy_check")).scalar()
            conn.execute(text("DROP TABLE _finfy_check"))
            conn.commit()
            print(f"✓ write/read round-trip OK (rows={n})")
    except Exception as exc:  # noqa: BLE001
        print(f"✗ connection failed: {exc}")
        return 1

    print("\nNext step:  .venv/bin/alembic upgrade head")
    return 0


if __name__ == "__main__":
    sys.exit(main())
