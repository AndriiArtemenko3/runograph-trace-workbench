"""Async SQLAlchemy engine bound to a local offline SQLite file.

Default path: ~/.runograph/runograph.sqlite
Override:     env RUNOGRAPH_DB_PATH=/absolute/path.sqlite

WAL journaling is enabled on every new connection for responsive concurrent
reads while a local CLI import is running.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .models import Base

SCHEMA_VERSION = 1
_INIT_ATTEMPTS = 5
_init_lock = asyncio.Lock()


def _chmod_private(path: Path, mode: int) -> None:
    if os.name == "posix" and path.exists():
        path.chmod(mode)


def _prepare_db_parent(db_path: Path, *, managed_default: bool) -> None:
    existed = db_path.parent.exists()
    db_path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    if managed_default or not existed:
        _chmod_private(db_path.parent, 0o700)


def _secure_sqlite_files(db_path: Path) -> None:
    for candidate in (db_path, Path(f"{db_path}-wal"), Path(f"{db_path}-shm")):
        _chmod_private(candidate, 0o600)


def get_db_path() -> Path:
    override = os.environ.get("RUNOGRAPH_DB_PATH")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".runograph" / "runograph.sqlite"


def _build_engine_url() -> str:
    db_path = get_db_path()
    _prepare_db_parent(
        db_path,
        managed_default=os.environ.get("RUNOGRAPH_DB_PATH") is None,
    )
    return f"sqlite+aiosqlite:///{db_path}"


engine = create_async_engine(
    _build_engine_url(),
    echo=False,
    # `check_same_thread=False` is the canonical aiosqlite/SQLite pattern; the
    # async layer already serialises connection use per session.
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine.sync_engine, "connect")
def _enable_wal(dbapi_conn, _connection_record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA database_list")
    database_file = next((row[2] for row in cur.fetchall() if row[1] == "main"), "")
    db_path = Path(database_file) if database_file else None
    if db_path is not None:
        _secure_sqlite_files(db_path)
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()
    if db_path is not None:
        _secure_sqlite_files(db_path)


AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def _init_db_once() -> None:
    async with engine.connect() as conn:
        await conn.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            version = (await conn.exec_driver_sql("PRAGMA user_version")).scalar_one()
            if version > SCHEMA_VERSION:
                raise RuntimeError(
                    f"database schema version {version} is newer than supported "
                    f"version {SCHEMA_VERSION}"
                )
            await conn.run_sync(Base.metadata.create_all)
            result = await conn.exec_driver_sql("PRAGMA table_info(run)")
            column_names = {row[1] for row in result.fetchall()}
            if "outcome_source" not in column_names:
                await conn.exec_driver_sql(
                    "ALTER TABLE run ADD COLUMN outcome_source "
                    "VARCHAR NOT NULL DEFAULT 'unknown'"
                )
            await conn.exec_driver_sql(f"PRAGMA user_version={SCHEMA_VERSION}")
            await conn.commit()
        except BaseException:
            await conn.rollback()
            raise


async def init_db() -> None:
    """Create tables and apply the narrow provenance compatibility update.

    Older prototype databases did not record outcome provenance. Those rows
    must never be relabelled as externally verified during startup, so the one
    supported compatibility update adds ``outcome_source='unknown'``. Current
    imports explicitly store ``external`` through the validated ingest path.
    """
    async with _init_lock:
        for attempt in range(_INIT_ATTEMPTS):
            try:
                await _init_db_once()
                _secure_sqlite_files(get_db_path())
                return
            except OperationalError as exc:
                locked = "locked" in str(exc).casefold()
                if not locked or attempt == _INIT_ATTEMPTS - 1:
                    raise
                await asyncio.sleep(0.05 * (2**attempt))


async def session_scope() -> AsyncIterator[AsyncSession]:
    """Yield an async session for FastAPI dependency injection."""
    async with AsyncSessionLocal() as session:
        yield session
