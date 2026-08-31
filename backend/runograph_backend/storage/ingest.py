"""Ingest one externally produced run directory into the SQLite trace store.

Expected layout:

  <run_dir>/
    meta.json        — RunMeta-shaped JSON with external outcome provenance
    events.jsonl     — one CanonicalEvent JSON per line (ordered by ts)

The ingest is idempotent only for the same ``run_id`` + experiment + task:
that identity replaces its prior rows in one transaction. A cross-experiment
or cross-task run-ID collision is rejected before mutation.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Event, RouteCluster, RouteMetric, Run
from .schemas import CanonicalEvent, RunMeta


@dataclass(frozen=True)
class ValidatedRunBundle:
    """A fully parsed run bundle that is safe to apply transactionally."""

    meta: RunMeta
    events: tuple[CanonicalEvent, ...]


def load_run_bundle(run_dir: Path) -> ValidatedRunBundle:
    """Validate a complete bundle before any database mutation occurs."""
    meta_path = run_dir / "meta.json"
    events_path = run_dir / "events.jsonl"
    if not meta_path.exists():
        raise FileNotFoundError(f"missing meta.json in {run_dir}")
    if not events_path.exists():
        raise FileNotFoundError(f"missing events.jsonl in {run_dir}")

    meta = RunMeta.model_validate(json.loads(meta_path.read_text()))
    events: list[CanonicalEvent] = []
    previous_timestamp = None
    with events_path.open() as event_file:
        for line_number, line in enumerate(event_file, start=1):
            line = line.strip()
            if not line:
                continue
            event = CanonicalEvent.model_validate(json.loads(line))
            if previous_timestamp is not None and event.timestamp < previous_timestamp:
                raise ValueError(
                    f"events.jsonl line {line_number}: timestamp precedes previous event"
                )
            if event.timestamp < meta.started_at:
                raise ValueError(
                    f"events.jsonl line {line_number}: timestamp precedes startedAt"
                )
            if meta.ended_at is not None and event.timestamp > meta.ended_at:
                raise ValueError(
                    f"events.jsonl line {line_number}: timestamp follows endedAt"
                )
            previous_timestamp = event.timestamp
            events.append(event)
    return ValidatedRunBundle(meta=meta, events=tuple(events))


async def ingest_validated_bundle(
    session: AsyncSession,
    bundle: ValidatedRunBundle,
    *,
    commit: bool,
) -> tuple[str, int]:
    """Apply one prevalidated bundle, optionally committing its transaction."""
    meta = bundle.meta
    existing = await session.get(Run, meta.run_id)
    if existing is not None and (
        existing.experiment_id != meta.experiment_id or existing.task_id != meta.task_id
    ):
        raise ValueError(
            f"runId {meta.run_id!r} already belongs to experiment/task "
            f"{existing.experiment_id!r}/{existing.task_id!r}; refusing replacement"
        )

    # A same-identity re-import is an explicit idempotent replacement. Rows
    # owned by another experiment/task are rejected above without mutation.
    await session.execute(delete(RouteCluster).where(RouteCluster.run_id == meta.run_id))
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
            outcome_source=meta.outcome_source,
            total_tokens=meta.total_tokens,
            total_cost_usd=meta.total_cost_usd,
            settings_hash=meta.settings_hash,
            experiment_id=meta.experiment_id,
        )
    )
    await session.flush()

    for event in bundle.events:
        session.add(
            Event(
                run_id=meta.run_id,
                event_id=event.event_id,
                parent_event_id=event.parent_event_id,
                ts=event.timestamp,
                type=event.type,
                target=event.target,
                content_summary=event.content_summary,
                tokens=event.cost.tokens,
                time_seconds=event.cost.time_seconds,
                task_relevance_score=event.task_relevance_score,
                raw_json=json.dumps(event.model_dump(mode="json", by_alias=True)),
            )
        )

    await session.flush()
    if commit:
        await session.commit()
    return meta.run_id, len(bundle.events)


async def ingest_run(
    session: AsyncSession, run_dir: Path, *, commit: bool = True
) -> tuple[str, int]:
    """Store caller-provided metadata/events without executing or grading them."""
    bundle = load_run_bundle(run_dir)
    try:
        return await ingest_validated_bundle(session, bundle, commit=commit)
    except BaseException:
        if commit:
            await session.rollback()
        raise


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
