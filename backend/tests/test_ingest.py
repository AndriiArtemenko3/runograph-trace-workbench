"""Round-trip test for the trace ingest pipeline.

Uses a temp SQLite DB (via env override) so the user's real
~/.runograph/runograph.sqlite is never touched by the test suite.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import sqlite3
from datetime import UTC
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from tests.conftest import FIXTURE_RUN as FIXTURE


def _write_bundle(path: Path, meta: dict, events: list[dict]) -> Path:
    path.mkdir()
    (path / "meta.json").write_text(json.dumps(meta))
    (path / "events.jsonl").write_text(
        "".join(json.dumps(event) + "\n" for event in events)
    )
    return path


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
    assert run.task_id == "synthetic-format-task"
    assert run.model == "fixture-model"
    assert run.outcome == "pass"
    assert run.outcome_source == "external"
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
    from runograph_backend.storage.models import Event, RouteCluster

    await ingest_run(session, FIXTURE)
    session.add(
        RouteCluster(
            experiment_id="fixture-test",
            cluster_id=1,
            run_id="sample-run-0001",
            distance_to_centroid=0.0,
            is_representative=True,
        )
    )
    await session.commit()
    await ingest_run(session, FIXTURE)  # re-ingest

    count = (
        await session.execute(
            select(func.count(Event.id)).where(Event.run_id == "sample-run-0001")
        )
    ).scalar_one()
    assert count == 10  # still 10, not 20
    cluster_count = (
        await session.execute(
            select(func.count(RouteCluster.id)).where(
                RouteCluster.run_id == "sample-run-0001"
            )
        )
    ).scalar_one()
    assert cluster_count == 0


@pytest.mark.asyncio
async def test_mixed_offset_timestamps_round_trip_as_utc_in_instant_order(
    session, tmp_path
):
    from runograph_backend.analysis import metrics, tables
    from runograph_backend.storage.ingest import ingest_run
    from runograph_backend.storage.models import Run

    run_dir = _write_bundle(
        tmp_path / "offset-run",
        {
            "runId": "offset-run",
            "taskId": "dst-fallback",
            "model": "fixture-model",
            # These instants straddle a repeated local hour and are 60 seconds apart.
            "startedAt": "2026-10-25T02:30:00+02:00",
            "endedAt": "2026-10-25T01:31:00+01:00",
            "outcome": "pass",
            "outcomeSource": "external",
            "totalTokens": 30,
            "totalCostUsd": 0.0,
            "experimentId": "offset-test",
        },
        [
            {
                "eventId": "first",
                "timestamp": "2026-10-25T02:30:10+02:00",
                "type": "file_read",
                "target": "first.py",
                "cost": {"tokens": 10, "timeSeconds": 0.1},
            },
            {
                "eventId": "second",
                "timestamp": "2026-10-25T01:30:50+01:00",
                "type": "file_edit",
                "target": "second.py",
                "cost": {"tokens": 20, "timeSeconds": 0.2},
            },
        ],
    )
    await ingest_run(session, run_dir)

    run = await session.get(Run, "offset-run")
    assert run is not None
    assert run.started_at.isoformat() == "2026-10-25T00:30:00+00:00"
    assert run.ended_at is not None
    assert run.ended_at.isoformat() == "2026-10-25T00:31:00+00:00"
    events = await tables.load_events_for_run(session, "offset-run")
    assert [event.event_id for event in events] == ["first", "second"]
    assert all(event.timestamp.tzinfo is UTC for event in events)
    indicators = metrics.run_indicators(
        outcome=run.outcome,
        total_tokens=run.total_tokens,
        total_cost_usd=run.total_cost_usd,
        started_at=run.started_at,
        ended_at=run.ended_at,
        events=events,
    )
    assert indicators["latency_s"] == 60.0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("changed_field", "changed_value"),
    [("experimentId", "other-experiment"), ("taskId", "other-task")],
)
async def test_cross_identity_run_id_collision_preserves_original_rows(
    session, tmp_path, changed_field, changed_value
):
    from runograph_backend.storage.ingest import ingest_run
    from runograph_backend.storage.models import Event, RouteCluster, RouteMetric, Run

    await ingest_run(session, FIXTURE)
    session.add_all(
        [
            RouteMetric(run_id="sample-run-0001", name="preserved", value=1.0),
            RouteCluster(
                experiment_id="fixture-test",
                cluster_id=9,
                run_id="sample-run-0001",
                distance_to_centroid=0.25,
                is_representative=True,
            ),
        ]
    )
    await session.commit()

    replacement = tmp_path / "collision"
    shutil.copytree(FIXTURE, replacement)
    meta = json.loads((replacement / "meta.json").read_text())
    meta[changed_field] = changed_value
    (replacement / "meta.json").write_text(json.dumps(meta))

    with pytest.raises(ValueError, match="refusing replacement"):
        await ingest_run(session, replacement)

    original = await session.get(Run, "sample-run-0001")
    assert original is not None
    assert (original.experiment_id, original.task_id) == (
        "fixture-test",
        "synthetic-format-task",
    )
    assert (
        await session.execute(
            select(func.count(Event.id)).where(Event.run_id == "sample-run-0001")
        )
    ).scalar_one() == 10
    assert (
        await session.execute(
            select(func.count(RouteMetric.id)).where(
                RouteMetric.run_id == "sample-run-0001"
            )
        )
    ).scalar_one() == 1
    assert (
        await session.execute(
            select(func.count(RouteCluster.id)).where(
                RouteCluster.run_id == "sample-run-0001"
            )
        )
    ).scalar_one() == 1


def test_run_meta_requires_external_outcome_provenance() -> None:
    from runograph_backend.storage.schemas import RunMeta, RunSummary

    payload = json.loads((FIXTURE / "meta.json").read_text())
    parsed = RunMeta.model_validate(payload)
    assert parsed.outcome == "pass"
    assert parsed.outcome_source == "external"
    summary = RunSummary(
        runId=parsed.run_id,
        taskId=parsed.task_id,
        model=parsed.model,
        outcome=parsed.outcome,
        outcomeSource=parsed.outcome_source,
        totalTokens=parsed.total_tokens,
        totalCostUsd=parsed.total_cost_usd,
        startedAt=parsed.started_at,
        endedAt=parsed.ended_at,
        experimentId=parsed.experiment_id,
        eventCount=10,
    )
    assert summary.model_dump(by_alias=True)["outcomeSource"] == "external"

    payload.pop("outcomeSource")
    with pytest.raises(ValidationError, match="outcomeSource"):
        RunMeta.model_validate(payload)

    payload["outcomeSource"] = "runograph"
    with pytest.raises(ValidationError, match="external"):
        RunMeta.model_validate(payload)

    payload["outcomeSource"] = "external"
    payload.pop("experimentId")
    with pytest.raises(ValidationError, match="experimentId"):
        RunMeta.model_validate(payload)

    payload["experimentId"] = "   "
    with pytest.raises(ValidationError, match="expected 1-128 ASCII"):
        RunMeta.model_validate(payload)


def test_ingest_schema_rejects_naive_chronology_and_invalid_measurements() -> None:
    from runograph_backend.storage.schemas import CanonicalEvent, EventCost, RunMeta

    payload = json.loads((FIXTURE / "meta.json").read_text())

    for field, value in (
        ("totalTokens", -1),
        ("totalCostUsd", -0.01),
        ("totalCostUsd", float("nan")),
        ("totalCostUsd", float("inf")),
    ):
        invalid = {**payload, field: value}
        with pytest.raises(ValidationError):
            RunMeta.model_validate(invalid)
    for required in ("totalTokens", "totalCostUsd"):
        invalid = dict(payload)
        invalid.pop(required)
        with pytest.raises(ValidationError, match=required):
            RunMeta.model_validate(invalid)
    for field, value in (
        ("totalTokens", True),
        ("totalTokens", "1"),
        ("totalCostUsd", True),
        ("totalCostUsd", "0.1"),
    ):
        with pytest.raises(ValidationError):
            RunMeta.model_validate({**payload, field: value})

    with pytest.raises(ValidationError, match="UTC offset"):
        RunMeta.model_validate({**payload, "startedAt": "2026-01-01T00:00:00"})
    for invalid_started_at in (0, 1.5, True, "0", "1.5", "1679616000", "-1"):
        with pytest.raises(ValidationError, match="ISO 8601 string"):
            RunMeta.model_validate({**payload, "startedAt": invalid_started_at})
    for invalid_ended_at in (0, 1.5, True, "0", "1.5", "1679616000", "-1"):
        with pytest.raises(ValidationError, match="ISO 8601 string"):
            RunMeta.model_validate({**payload, "endedAt": invalid_ended_at})
    with pytest.raises(ValidationError, match="endedAt must not precede startedAt"):
        RunMeta.model_validate(
            {
                **payload,
                "startedAt": "2026-01-01T00:01:00Z",
                "endedAt": "2026-01-01T00:00:00Z",
            }
        )
    with pytest.raises(ValidationError, match="endedAt is required"):
        RunMeta.model_validate({**payload, "endedAt": None})

    for cost in (
        {},
        {"tokens": -1, "timeSeconds": 0.1},
        {"tokens": 1, "timeSeconds": -0.1},
        {"tokens": 1, "timeSeconds": float("inf")},
        {"tokens": True, "timeSeconds": 0.1},
        {"tokens": "1", "timeSeconds": 0.1},
        {"tokens": 1, "timeSeconds": True},
        {"tokens": 1, "timeSeconds": "0.1"},
    ):
        with pytest.raises(ValidationError):
            EventCost.model_validate(cost)
    with pytest.raises(ValidationError, match="UTC offset"):
        CanonicalEvent.model_validate(
            {
                "eventId": "event-1",
                "timestamp": "2026-01-01T00:00:00",
                "type": "file_read",
                "cost": {"tokens": 1, "timeSeconds": 0.1},
            }
        )
    for invalid_timestamp in (0, 1.5, True, "0", "1.5", "1679616000", "-1"):
        with pytest.raises(ValidationError, match="ISO 8601 string"):
            CanonicalEvent.model_validate(
                {
                    "eventId": "event-1",
                    "timestamp": invalid_timestamp,
                    "type": "file_read",
                    "cost": {"tokens": 1, "timeSeconds": 0.1},
                }
            )
    with pytest.raises(ValidationError):
        CanonicalEvent.model_validate(
            {
                "eventId": "event-1",
                "timestamp": "2026-01-01T00:00:00Z",
                "type": "file_read",
                "cost": {"tokens": 1, "timeSeconds": 0.1},
                "taskRelevanceScore": float("nan"),
            }
        )


def test_public_identifier_contract_rejects_scope_and_path_delimiters() -> None:
    from runograph_backend.analysis.run_filter import parse_run_whitelist
    from runograph_backend.storage.schemas import RunMeta

    payload = json.loads((FIXTURE / "meta.json").read_text())
    for field in ("runId", "taskId", "experimentId"):
        for invalid in (
            "",
            "   ",
            "a,b",
            "a/b",
            "../escape",
            "white space",
            "unicode-é",
        ):
            with pytest.raises(ValidationError):
                RunMeta.model_validate({**payload, field: invalid})
    for invalid in ("  safe-run  ", "line-break\n"):
        with pytest.raises(ValidationError):
            RunMeta.model_validate({**payload, "runId": invalid})
    for raw in (",,,", "safe-run,a/b", "../escape", "safe-run, other"):
        with pytest.raises(ValueError):
            parse_run_whitelist(raw)


@pytest.mark.asyncio
async def test_ingest_rejects_out_of_order_events_before_mutation(session, tmp_path):
    from runograph_backend.storage.ingest import ingest_run
    from runograph_backend.storage.models import Event, Run

    await ingest_run(session, FIXTURE)
    invalid = tmp_path / "out-of-order"
    shutil.copytree(FIXTURE, invalid)
    lines = (invalid / "events.jsonl").read_text().splitlines()
    (invalid / "events.jsonl").write_text("\n".join(reversed(lines)) + "\n")
    with pytest.raises(ValueError, match="precedes previous event"):
        await ingest_run(session, invalid)
    assert await session.get(Run, "sample-run-0001") is not None
    assert (
        await session.execute(
            select(func.count(Event.id)).where(Event.run_id == "sample-run-0001")
        )
    ).scalar_one() == 10


@pytest.mark.asyncio
async def test_init_db_is_concurrent_on_fresh_database(_isolate_db) -> None:
    from runograph_backend.storage import db as db_mod

    await asyncio.gather(*(db_mod.init_db() for _ in range(8)))
    async with db_mod.engine.connect() as connection:
        version = (await connection.exec_driver_sql("PRAGMA user_version")).scalar_one()
        columns = {
            row[1]
            for row in (
                await connection.exec_driver_sql("PRAGMA table_info(run)")
            ).fetchall()
        }
    assert version == db_mod.SCHEMA_VERSION
    assert "outcome_source" in columns


@pytest.mark.asyncio
async def test_init_db_marks_pre_provenance_rows_unknown(_isolate_db) -> None:
    """The supported legacy update must not invent external provenance."""
    from runograph_backend.storage import db as db_mod
    from runograph_backend.storage.models import Run

    await db_mod.engine.dispose()
    with sqlite3.connect(_isolate_db) as connection:
        connection.execute(
            """
            CREATE TABLE run (
                id VARCHAR NOT NULL PRIMARY KEY,
                task_id VARCHAR NOT NULL,
                model VARCHAR NOT NULL,
                started_at DATETIME NOT NULL,
                ended_at DATETIME,
                outcome VARCHAR NOT NULL,
                total_tokens INTEGER NOT NULL,
                total_cost_usd FLOAT NOT NULL,
                settings_hash VARCHAR,
                experiment_id VARCHAR
            )
            """
        )
        connection.execute(
            """
            INSERT INTO run (
                id, task_id, model, started_at, ended_at, outcome,
                total_tokens, total_cost_usd, settings_hash, experiment_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "legacy-run",
                "legacy-task",
                "legacy-model",
                "2026-01-01 00:00:00",
                None,
                "pass",
                0,
                0.0,
                None,
                "legacy-experiment",
            ),
        )

    await asyncio.gather(*(db_mod.init_db() for _ in range(8)))
    async with db_mod.AsyncSessionLocal() as legacy_session:
        run = await legacy_session.get(Run, "legacy-run")
        assert run is not None
        assert run.outcome == "pass"
        assert run.outcome_source == "unknown"

    # A second startup is idempotent and preserves the conservative source.
    await db_mod.init_db()
    async with db_mod.engine.connect() as connection:
        value = (
            await connection.exec_driver_sql(
                "SELECT outcome_source FROM run WHERE id = 'legacy-run'"
            )
        ).scalar_one()
    assert value == "unknown"


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission contract")
@pytest.mark.asyncio
async def test_database_directory_and_sqlite_files_are_private_under_umask_022(
    _isolate_db, tmp_path, monkeypatch
) -> None:
    import importlib
    import stat

    from runograph_backend.storage import db as db_mod

    await db_mod.engine.dispose()
    private_db = tmp_path / "new-private-dir" / "trace.sqlite"
    monkeypatch.setenv("RUNOGRAPH_DB_PATH", str(private_db))
    previous_umask = os.umask(0o022)
    try:
        importlib.reload(db_mod)
        await db_mod.init_db()
        async with db_mod.engine.begin() as connection:
            await connection.exec_driver_sql(
                "INSERT INTO run ("
                "id, task_id, model, started_at, ended_at, outcome, outcome_source, "
                "total_tokens, total_cost_usd, experiment_id"
                ") VALUES ("
                "'permission-run', 'permission-task', 'model', "
                "'2026-01-01 00:00:00', '2026-01-01 00:00:01', 'pass', "
                "'external', 1, 0.0, 'permission-experiment'"
                ")"
            )
        # Exercise the explicit sidecar hardening path even on SQLite builds
        # that eagerly checkpoint and remove their WAL/SHM files.
        for suffix in ("-wal", "-shm"):
            sidecar = Path(f"{private_db}{suffix}")
            if not sidecar.exists():
                sidecar.touch(mode=0o644)
        db_mod._secure_sqlite_files(private_db)
    finally:
        os.umask(previous_umask)

    assert stat.S_IMODE(private_db.parent.stat().st_mode) == 0o700
    for path in (private_db, Path(f"{private_db}-wal"), Path(f"{private_db}-shm")):
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
