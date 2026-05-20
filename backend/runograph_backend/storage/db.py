"""Async SQLAlchemy 2.0 engine bound to a per-experiment SQLite file.

Default path: ~/.runograph/runs/runograph-50/runograph.sqlite
Override:     env RUNOGRAPH_DB_PATH=/absolute/path.sqlite

WAL journaling is enabled on every new connection so the 50-run orchestrator
can write events concurrently from multiple in-process tasks without
serialising on the default rollback journal.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .models import Base


def get_db_path() -> Path:
    override = os.environ.get("RUNOGRAPH_DB_PATH")
    if override:
        return Path(override).expanduser()
    return (
        Path.home()
        / ".runograph"
        / "runs"
        / "runograph-50"
        / "runograph.sqlite"
    )


def _build_engine_url() -> str:
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{db_path}"


engine = create_async_engine(
    _build_engine_url(),
    echo=False,
    # `check_same_thread=False` is the canonical aiosqlite/SQLite pattern; the
    # async layer already serialises connection use per session.
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine.sync_engine, "connect")
def _enable_wal(dbapi_conn, _connection_record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def init_db() -> None:
    """Create tables idempotently. Called from FastAPI lifespan on startup."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def session_scope() -> AsyncIterator[AsyncSession]:
    """Yield an async session for FastAPI dependency injection."""
    async with AsyncSessionLocal() as session:
        yield session
