"""Regression tests for the deterministic, untracked demo seed workflow."""

from __future__ import annotations

import os
import stat
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import func, select


@pytest.mark.asyncio
async def test_demo_seed_ingests_synthetic_external_labels(session, tmp_path) -> None:
    from runograph_backend.storage.models import Event, Run
    from scripts.seed_demo import DEMO_EXPERIMENT_ID, DEMO_RUNS, seed_demo_runs

    bundle = tmp_path / "bundle"
    run_count, event_count = await seed_demo_runs(session, bundle)
    session.add(
        Run(
            id="stale-demo",
            task_id="stale",
            model="stale",
            started_at=datetime(2026, 1, 1, tzinfo=UTC),
            ended_at=None,
            outcome="fail",
            total_tokens=0,
            total_cost_usd=0.0,
            experiment_id=DEMO_EXPERIMENT_ID,
        )
    )
    await session.commit()
    repeated_run_count, repeated_event_count = await seed_demo_runs(session, bundle)

    assert run_count == len(DEMO_RUNS) == 6
    assert event_count == sum(len(spec.events) for spec in DEMO_RUNS)
    assert (repeated_run_count, repeated_event_count) == (run_count, event_count)
    rows = (
        await session.execute(
            select(Run).where(Run.experiment_id == DEMO_EXPERIMENT_ID).order_by(Run.id)
        )
    ).scalars().all()
    assert [row.id for row in rows] == sorted(spec.run_id for spec in DEMO_RUNS)
    assert "stale-demo" not in {row.id for row in rows}
    assert {row.outcome for row in rows} == {"pass", "fail", "error"}
    assert {row.outcome_source for row in rows} == {"external"}
    assert (
        await session.execute(
            select(func.count(Event.id)).join(Run, Event.run_id == Run.id).where(
                Run.experiment_id == DEMO_EXPERIMENT_ID
            )
        )
    ).scalar_one() == event_count


@pytest.mark.asyncio
async def test_demo_seed_refuses_cross_experiment_run_id_collision(
    session, tmp_path
) -> None:
    from runograph_backend.storage.models import Run
    from scripts.seed_demo import DEMO_RUNS, seed_demo_runs

    colliding_id = DEMO_RUNS[0].run_id
    session.add(
        Run(
            id=colliding_id,
            task_id="protected",
            model="protected",
            started_at=datetime(2026, 1, 1, tzinfo=UTC),
            ended_at=None,
            outcome="fail",
            total_tokens=0,
            total_cost_usd=0.0,
            experiment_id="protected-experiment",
        )
    )
    await session.commit()

    with pytest.raises(ValueError, match="reserved demo run IDs"):
        await seed_demo_runs(session, tmp_path / "bundle")

    protected = await session.get(Run, colliding_id)
    assert protected is not None
    assert protected.experiment_id == "protected-experiment"


@pytest.mark.asyncio
async def test_demo_reseed_failure_rolls_back_to_complete_previous_dataset(
    session, tmp_path, monkeypatch
) -> None:
    from runograph_backend.storage import ingest as ingest_mod
    from runograph_backend.storage.models import Event, Run
    from scripts.seed_demo import DEMO_EXPERIMENT_ID, seed_demo_runs

    bundle = tmp_path / "atomic-bundle"
    assert await seed_demo_runs(session, bundle) == (6, 30)
    original = ingest_mod.ingest_validated_bundle
    calls = 0

    async def fail_on_third(session_arg, validated, *, commit):
        nonlocal calls
        calls += 1
        if calls == 3:
            raise RuntimeError("injected reseed failure")
        return await original(session_arg, validated, commit=commit)

    monkeypatch.setattr(ingest_mod, "ingest_validated_bundle", fail_on_third)
    with pytest.raises(RuntimeError, match="injected reseed failure"):
        await seed_demo_runs(session, bundle)

    run_ids = (
        await session.execute(
            select(Run.id)
            .where(Run.experiment_id == DEMO_EXPERIMENT_ID)
            .order_by(Run.id)
        )
    ).scalars().all()
    event_count = (
        await session.execute(
            select(func.count(Event.id)).join(Run, Event.run_id == Run.id).where(
                Run.experiment_id == DEMO_EXPERIMENT_ID
            )
        )
    ).scalar_one()
    assert run_ids == ["demo-a1", "demo-a2", "demo-a3", "demo-b1", "demo-b2", "demo-b3"]
    assert event_count == 30


def _run_seed_cli(cwd: Path, *args: str) -> None:
    backend_root = Path(__file__).resolve().parents[1]
    env = os.environ.copy()
    env.pop("RUNOGRAPH_DB_PATH", None)
    existing_pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(backend_root) + (
        os.pathsep + existing_pythonpath if existing_pythonpath else ""
    )
    subprocess.run(
        [sys.executable, "-m", "scripts.seed_demo", *args],
        cwd=cwd,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission contract")
def test_default_demo_seed_hardens_preexisting_parent_under_umask_022(
    tmp_path,
) -> None:
    demo_dir = tmp_path / ".runograph-demo"
    demo_dir.mkdir(mode=0o755)
    demo_dir.chmod(0o755)

    previous_umask = os.umask(0o022)
    try:
        _run_seed_cli(tmp_path)
        _run_seed_cli(tmp_path)
    finally:
        os.umask(previous_umask)

    database = demo_dir / "runograph.sqlite"
    assert stat.S_IMODE(demo_dir.stat().st_mode) == 0o700
    assert stat.S_IMODE(database.stat().st_mode) == 0o600
    for suffix in ("-wal", "-shm"):
        sidecar = Path(f"{database}{suffix}")
        if sidecar.exists():
            assert stat.S_IMODE(sidecar.stat().st_mode) == 0o600


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission contract")
def test_explicit_demo_db_preserves_existing_parent_mode(tmp_path) -> None:
    explicit_parent = tmp_path / "caller-owned"
    explicit_parent.mkdir(mode=0o755)
    explicit_parent.chmod(0o755)
    database = explicit_parent / "demo.sqlite"

    previous_umask = os.umask(0o022)
    try:
        _run_seed_cli(tmp_path, "--db", str(database))
    finally:
        os.umask(previous_umask)

    assert stat.S_IMODE(explicit_parent.stat().st_mode) == 0o755
    assert stat.S_IMODE(database.stat().st_mode) == 0o600
    for suffix in ("-wal", "-shm"):
        sidecar = Path(f"{database}{suffix}")
        if sidecar.exists():
            assert stat.S_IMODE(sidecar.stat().st_mode) == 0o600
