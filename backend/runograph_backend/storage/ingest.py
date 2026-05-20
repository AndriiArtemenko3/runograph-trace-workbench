"""Ingest one run directory into the SQLite trace store.

Layout expected (produced by the orchestrator in Stage 2):

  <run_dir>/
    meta.json        — RunMeta-shaped JSON (one object)
    events.jsonl     — one CanonicalEvent JSON per line (ordered by ts)
    stream.jsonl     — Claude Code stream-json output (optional; only used
                       for token reconciliation in this stage)

The ingest is idempotent: re-running on the same `run_id` purges previous
rows for that run before reinserting. Useful when an experiment is replayed
after a schema tweak.
"""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Event, Run, RouteMetric
from .schemas import CanonicalEvent, RunMeta


async def ingest_run(session: AsyncSession, run_dir: Path) -> tuple[str, int]:
    """Parse `run_dir`, write to SQLite, return (run_id, events_ingested)."""
    meta_path = run_dir / "meta.json"
    events_path = run_dir / "events.jsonl"
    if not meta_path.exists():
        raise FileNotFoundError(f"missing meta.json in {run_dir}")
    if not events_path.exists():
        raise FileNotFoundError(f"missing events.jsonl in {run_dir}")

    meta = RunMeta.model_validate(json.loads(meta_path.read_text()))

    # Purge any prior ingest of this run_id so re-runs are clean.
    await session.execute(delete(RouteMetric).where(RouteMetric.run_id == meta.run_id))
    await session.execute(delete(Event).where(Event.run_id == meta.run_id))
    await session.execute(delete(Run).where(Run.id == meta.run_id))

    session.add(
        Run(
            id=meta.run_id,
            task_id=meta.task_id,
            model=meta.model,
            started_at=meta.started_at,
            ended_at=meta.ended_at,
            outcome=meta.outcome,
            total_tokens=meta.total_tokens,
            total_cost_usd=meta.total_cost_usd,
            settings_hash=meta.settings_hash,
            experiment_id=meta.experiment_id,
        )
    )
    # Flush so the Event rows below can satisfy the FK without a round-trip
    # through the autoflush heuristic (which only fires on SELECT, not INSERT).
    await session.flush()

    events_ingested = 0
    with events_path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            evt = CanonicalEvent.model_validate(json.loads(line))
            session.add(
                Event(
                    run_id=meta.run_id,
                    event_id=evt.event_id,
                    parent_event_id=evt.parent_event_id,
                    ts=evt.timestamp,
                    type=evt.type,
                    target=evt.target,
                    content_summary=evt.content_summary,
                    tokens=evt.cost.tokens,
                    time_seconds=evt.cost.time_seconds,
                    task_relevance_score=evt.task_relevance_score,
                    raw_json=json.dumps(evt.model_dump(mode="json", by_alias=True)),
                )
            )
            events_ingested += 1

    await session.commit()
    return meta.run_id, events_ingested


async def count_events_for_run(session: AsyncSession, run_id: str) -> int:
    return (
        await session.execute(
            select(func.count(Event.id)).where(Event.run_id == run_id)
        )
    ).scalar_one()


async def get_run(session: AsyncSession, run_id: str) -> Run | None:
    return (
        await session.execute(select(Run).where(Run.id == run_id))
    ).scalar_one_or_none()
