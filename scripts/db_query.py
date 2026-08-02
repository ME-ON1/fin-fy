"""Run a SQL query against whatever DB is configured in .env.

Usage:
    .venv/bin/python scripts/db_query.py "SELECT name FROM sqlite_master WHERE type='table'"
    .venv/bin/python scripts/db_query.py "SELECT * FROM members"
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402

from app.database import engine  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: db_query.py <sql>")
        return 1
    sql = sys.argv[1]
    with engine.connect() as conn:
        result = conn.execute(text(sql))
        if result.returns_rows:
            cols = list(result.keys())
            print("\t".join(cols))
            for row in result:
                print("\t".join("" if v is None else str(v) for v in row))
        else:
            print(f"OK, {result.rowcount} row(s) affected")
    return 0


if __name__ == "__main__":
    sys.exit(main())
