"""Shared fixtures: every test gets an isolated SQLite DB in a tmpdir so the
user's real ~/.runograph store is never touched."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest_asyncio

FIXTURE_RUN = Path(__file__).parent / "fixtures" / "sample-run"


async def ingest_run_variant(session, tmp_path: Path, run_id: str, outcome: str):
    """Ingest a copy of the sample run under a new run id + outcome, so
    tests get a multi-run experiment where scoping is meaningful."""
    from runograph_backend.storage.ingest import ingest_run

    dst = tmp_path / f"variant-{run_id}"
    shutil.copytree(FIXTURE_RUN, dst)
    meta = json.loads((dst / "meta.json").read_text())
    meta["runId"] = run_id
    meta["outcome"] = outcome
    (dst / "meta.json").write_text(json.dumps(meta))
    return await ingest_run(session, dst)


@pytest_asyncio.fixture(autouse=True)
async def _isolate_db(tmp_path, monkeypatch):
    """Each test gets its own ~/.runograph database in a tmpdir."""
    db_path = tmp_path / "runograph-test.sqlite"
    monkeypatch.setenv("RUNOGRAPH_DB_PATH", str(db_path))
    # Reset module-level engine so it picks up the new env var.
    import importlib

    from runograph_backend.storage import db as db_mod

    importlib.reload(db_mod)
    yield db_path
    await db_mod.engine.dispose()


@pytest_asyncio.fixture
async def session():
    from runograph_backend.storage.db import AsyncSessionLocal, init_db

    await init_db()
    async with AsyncSessionLocal() as s:
        yield s
