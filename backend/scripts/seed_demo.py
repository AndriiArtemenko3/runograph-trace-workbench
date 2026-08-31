"""Seed a small, deterministic offline dataset for the RunoGraph workbench.

The traces and their terminal outcomes are synthetic caller-provided demo
metadata. They are not benchmark results and are not verified by RunoGraph.
No generated trace bundle or SQLite database is committed to the repository.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from sqlalchemy import delete, or_, select

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

DEMO_EXPERIMENT_ID = "demo-offline"
DEFAULT_DEMO_DB = Path(".runograph-demo/runograph.sqlite")
EventKind = Literal["file_read", "file_edit", "test_run", "tool_call", "error", "final"]


@dataclass(frozen=True)
class DemoEvent:
    kind: EventKind
    target: str | None
    tokens: int
    seconds: float


@dataclass(frozen=True)
class DemoRun:
    run_id: str
    model: str
    outcome: Literal["pass", "fail", "error"]
    events: tuple[DemoEvent, ...]


READ = DemoEvent("file_read", "src/parser.py", 180, 0.7)
SEARCH = DemoEvent("tool_call", "search: parse_token", 90, 0.3)
TEST = DemoEvent("test_run", "tests/test_parser.py", 120, 2.4)
EDIT = DemoEvent("file_edit", "src/parser.py", 140, 0.6)
CONFIG = DemoEvent("file_read", "pyproject.toml", 70, 0.2)
ERROR = DemoEvent("error", "tests/test_parser.py", 80, 0.4)
FINAL = DemoEvent("final", None, 40, 0.1)

DEMO_RUNS = (
    DemoRun("demo-a1", "producer-a", "pass", (READ, SEARCH, EDIT, TEST, FINAL)),
    DemoRun("demo-a2", "producer-a", "fail", (READ, SEARCH, TEST, EDIT, TEST, FINAL)),
    DemoRun("demo-a3", "producer-a", "pass", (CONFIG, READ, EDIT, TEST, FINAL)),
    DemoRun("demo-b1", "producer-b", "error", (CONFIG, TEST, ERROR, FINAL)),
    DemoRun("demo-b2", "producer-b", "fail", (READ, TEST, ERROR, READ, FINAL)),
    DemoRun("demo-b3", "producer-b", "pass", (SEARCH, READ, EDIT, TEST, FINAL)),
)


def write_demo_bundle(root: Path) -> list[Path]:
    """Write deterministic temporary run directories and return their paths."""
    run_dirs: list[Path] = []
    origin = datetime(2026, 1, 15, 12, 0, tzinfo=UTC)
    for run_index, spec in enumerate(DEMO_RUNS):
        run_dir = root / spec.run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        started_at = origin + timedelta(minutes=run_index * 5)
        elapsed = 0.0
        events: list[dict[str, object]] = []
        previous_id: str | None = None
        for event_index, event in enumerate(spec.events, start=1):
            elapsed += event.seconds
            event_id = f"{spec.run_id}-e{event_index:02d}"
            events.append(
                {
                    "eventId": event_id,
                    "timestamp": (started_at + timedelta(seconds=elapsed)).isoformat(),
                    "type": event.kind,
                    "target": event.target,
                    "contentSummary": "synthetic offline demo event",
                    "cost": {"tokens": event.tokens, "timeSeconds": event.seconds},
                    "parentEventId": previous_id,
                    "taskRelevanceScore": None,
                }
            )
            previous_id = event_id

        total_tokens = sum(event.tokens for event in spec.events)
        meta = {
            "runId": spec.run_id,
            "taskId": "synthetic-parser-task",
            "model": spec.model,
            "startedAt": started_at.isoformat(),
            "endedAt": (started_at + timedelta(seconds=elapsed)).isoformat(),
            "outcome": spec.outcome,
            "outcomeSource": "external",
            "totalTokens": total_tokens,
            # Synthetic caller-provided cost, not a model-price calculation.
            "totalCostUsd": round(total_tokens / 100_000, 6),
            "experimentId": DEMO_EXPERIMENT_ID,
            "settingsHash": "synthetic-demo-v1",
        }
        (run_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
        (run_dir / "events.jsonl").write_text(
            "".join(json.dumps(event, separators=(",", ":")) + "\n" for event in events)
        )
        run_dirs.append(run_dir)
    return run_dirs


async def seed_demo_runs(session: AsyncSession, bundle_root: Path) -> tuple[int, int]:
    """Atomically replace the demo experiment with a prevalidated bundle."""
    from runograph_backend.storage.ingest import (
        ingest_validated_bundle,
        load_run_bundle,
    )
    from runograph_backend.storage.models import Event, RouteCluster, RouteMetric, Run

    run_dirs = write_demo_bundle(bundle_root)
    bundles = tuple(load_run_bundle(run_dir) for run_dir in run_dirs)
    reserved_ids = tuple(spec.run_id for spec in DEMO_RUNS)
    event_count = sum(len(bundle.events) for bundle in bundles)

    async with session.begin():
        collisions = (
            await session.execute(
                select(Run.id).where(
                    Run.id.in_(reserved_ids),
                    or_(
                        Run.experiment_id.is_(None),
                        Run.experiment_id != DEMO_EXPERIMENT_ID,
                    ),
                )
            )
        ).scalars().all()
        if collisions:
            joined = ", ".join(sorted(collisions))
            raise ValueError(
                "cannot seed demo-offline: reserved demo run IDs belong to another "
                f"experiment ({joined})"
            )

        demo_run_ids = select(Run.id).where(Run.experiment_id == DEMO_EXPERIMENT_ID)
        await session.execute(
            delete(RouteCluster).where(RouteCluster.run_id.in_(demo_run_ids))
        )
        await session.execute(
            delete(RouteMetric).where(RouteMetric.run_id.in_(demo_run_ids))
        )
        await session.execute(delete(Event).where(Event.run_id.in_(demo_run_ids)))
        await session.execute(delete(Run).where(Run.experiment_id == DEMO_EXPERIMENT_ID))

        for bundle in bundles:
            await ingest_validated_bundle(session, bundle, commit=False)
    return len(bundles), event_count


async def _seed_database() -> tuple[int, int]:
    # Imported after RUNOGRAPH_DB_PATH is set so the module-level engine uses
    # the selected demo database rather than the user's default trace store.
    from runograph_backend.storage.db import AsyncSessionLocal, init_db

    await init_db()
    with tempfile.TemporaryDirectory(prefix="runograph-demo-") as temp_dir:
        async with AsyncSessionLocal() as session:
            return await seed_demo_runs(session, Path(temp_dir))


def _resolve_demo_database(db_override: Path | None) -> Path:
    """Resolve the CLI database and secure only RunoGraph's managed default.

    Omitting ``--db`` opts into the repository-local demo store, whose parent
    is private even if an older run created it permissively. Supplying
    ``--db`` is an explicit choice: storage creates a missing parent privately,
    but preserves the mode of an existing caller-owned directory.
    """
    managed_default = db_override is None
    database = (db_override or DEFAULT_DEMO_DB).expanduser().resolve()
    if managed_default:
        database.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        if os.name == "posix":
            database.parent.chmod(0o700)
    return database


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="demo SQLite path (default: backend/.runograph-demo/runograph.sqlite)",
    )
    args = parser.parse_args()
    database = _resolve_demo_database(args.db)
    os.environ["RUNOGRAPH_DB_PATH"] = str(database)
    try:
        runs, events = asyncio.run(_seed_database())
    except ValueError as exc:
        parser.error(str(exc))
    print(f"replaced demo experiment with {runs} synthetic runs / {events} events in {database}")
    print(f"experiment id: {DEMO_EXPERIMENT_ID}")
    print("outcomes and costs are synthetic caller-provided metadata, not verified results")


if __name__ == "__main__":
    main()
