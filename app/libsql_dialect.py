"""SQLAlchemy dialect for Turso (libSQL) using the pure-Python Hrana client.

`s sqlalchemy-libsql` needs the Rust `libsql-experimental` bindings which don't
build on Python 3.14/arm64 yet, so we adapt SQLite's pysqlite dialect to the
pure-Python `libsql_client.dbapi2` driver instead. It speaks the same wire
protocol (wss) to Turso and keeps full SQLite semantics, which is exactly what
our schema needs.

Usage (see app/database.py):
    engine = create_engine(
        "libsql://finfy-<org>.turso.io",
        dialect=LibsqlDialect,
        connect_args={"auth_token": "<token>"},
    )
"""

from sqlalchemy.dialects.sqlite.pysqlite import SQLiteDialect_pysqlite
from sqlalchemy.dialects import registry


SCHEMES = ("libsql", "ws", "wss")


def register_dialects() -> None:
    """Register the dialect for libsql://, ws:// and wss:// URLs."""
    for scheme in SCHEMES:
        registry.register(scheme, "app.libsql_dialect", "LibsqlDialect")


class LibsqlDialect(SQLiteDialect_pysqlite):
    driver = "libsql"
    supports_statement_cache = True

    @classmethod
    def import_dbapi(cls):
        # Python 3.14 removed sqlite3.dbapi2.version; libsql_client still
        # imports it. Patch before importing the driver.
        import sqlite3

        if not hasattr(sqlite3.dbapi2, "version"):
            sqlite3.dbapi2.version = sqlite3.sqlite_version
        import libsql_client.dbapi2 as dbapi

        return dbapi

    def create_connect_args(self, url):
        # Pass the full libsql:// URL straight to the driver (pysqlite's
        # default would reject non-file URLs). auth_token is merged in from
        # create_engine(connect_args=...) automatically.
        return ([url.render_as_string(hide_password=False)], {})

    def on_connect(self):
        # Remote libSQL is always synchronous per-statement; the sqlite
        # PRAGMAs we care about are handled by the server. Skip local pragmas.
        return None

    def do_rollback(self, dbapi_connection):
        # sqlite's default rollback is a no-op when no transaction is open;
        # libsql Hrana has no explicit BEGIN/ROLLBACK support pre-3.0 style,
        # so make rollback a safe no-op too (avoids "cannot rollback" errors).
        try:
            dbapi_connection.rollback()
        except Exception:  # noqa: BLE001
            pass
