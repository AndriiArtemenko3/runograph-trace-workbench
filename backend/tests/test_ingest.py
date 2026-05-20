"""Round-trip test for the trace ingest pipeline.

Uses a temp SQLite DB (via env override) so the user's real
~/.runograph/runs/.../runograph.sqlite is never touched by the test suite.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import func, select


FIXTURE = Path(__file__).parent / "fixtures" / "sample-run"


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


@pytest.mark.asyncio
async def test_ingest_writes_run_and_events(session):
    from runograph_backend.storage.ingest import ingest_run
    from runograph_backend.storage.models import Event, Run

    run_id, events_ingested = await ingest_run(session, FIXTURE)

    assert run_id == "sample-run-0001"
    assert events_ingested == 10

    # Run row landed
    run = (
        await session.execute(select(Run).where(Run.id == run_id))
    ).scalar_one()
    assert run.task_id == "pylint-dev__pylint-7993"
    assert run.model == "claude-sonnet-4-6"
    assert run.outcome == "pass"
    assert run.experiment_id == "fixture-test"
    assert run.total_tokens == 11842

    # 10 events landed
    count = (
        await session.execute(
            select(func.count(Event.id)).where(Event.run_id == run_id)
        )
    ).scalar_one()
    assert count == 10

    # Parent-child links resolve (e_0002 -> e_0001)
    e2 = (
        await session.execute(
            select(Event).where(Event.run_id == run_id, Event.event_id == "e_0002")
        )
    ).scalar_one()
    assert e2.parent_event_id == "e_0001"

    # Type distribution sanity
    types = {
        row[0]
        for row in (
            await session.execute(
                select(Event.type).where(Event.run_id == run_id).distinct()
            )
        ).all()
    }
    assert {"file_read", "file_edit", "tool_call", "test_run", "reflection", "final"} <= types


@pytest.mark.asyncio
async def test_ingest_is_idempotent(session):
    from runograph_backend.storage.ingest import ingest_run
    from runograph_backend.storage.models import Event

    await ingest_run(session, FIXTURE)
    await ingest_run(session, FIXTURE)  # re-ingest

    count = (
        await session.execute(
            select(func.count(Event.id)).where(Event.run_id == "sample-run-0001")
        )
    ).scalar_one()
    assert count == 10  # still 10, not 20
