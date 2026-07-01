"""Shared fixtures: every test gets an isolated SQLite DB in a tmpdir so the
user's real ~/.runograph store is never touched."""

from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio

FIXTURE_RUN = Path(__file__).parent / "fixtures" / "sample-run"


@pytest.fixture(autouse=True)
def _isolate_db(tmp_path, monkeypatch):
    """Each test gets its own ~/.runograph database in a tmpdir."""
    db_path = tmp_path / "runograph-test.sqlite"
    monkeypatch.setenv("RUNOGRAPH_DB_PATH", str(db_path))
    # Reset module-level engine so it picks up the new env var.
    import importlib

    from runograph_backend.storage import db as db_mod

    importlib.reload(db_mod)
    yield db_path


@pytest_asyncio.fixture
async def session():
    from runograph_backend.storage.db import AsyncSessionLocal, init_db

    await init_db()
    async with AsyncSessionLocal() as s:
        yield s
