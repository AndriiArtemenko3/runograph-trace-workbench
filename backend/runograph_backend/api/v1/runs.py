"""Read-only API for externally captured runs.

Ingestion is deliberately a local CLI operation. The HTTP service never
accepts a server-filesystem path, executes trace contents, or verifies the
caller-provided outcome labels.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...storage.db import session_scope
from ...storage.ingest import count_events_for_run
from ...storage.models import Run
from ...storage.schemas import (
    ExperimentId,
    RunId,
    RunSummary,
    normalize_outcome_source,
)

router = APIRouter(prefix="/api/v1", tags=["runs"])


@router.get(
    "/runs",
    response_model=list[RunSummary],
    response_model_by_alias=True,
)
async def list_runs(
    session: Annotated[AsyncSession, Depends(session_scope)],
    experiment_id: Annotated[
        ExperimentId | None, Query(alias="experimentId")
    ] = None,
) -> list[RunSummary]:
    stmt = select(Run).order_by(Run.started_at.desc())
    if experiment_id is not None:
        stmt = stmt.where(Run.experiment_id == experiment_id)
    rows = (await session.execute(stmt)).scalars().all()
    out: list[RunSummary] = []
    for r in rows:
        count = await count_events_for_run(session, r.id)
        out.append(
            RunSummary(
                runId=r.id,
                taskId=r.task_id,
                model=r.model,
                outcome=r.outcome,
                outcomeSource=normalize_outcome_source(r.outcome_source),
                totalTokens=r.total_tokens,
                totalCostUsd=r.total_cost_usd,
                startedAt=r.started_at,
                endedAt=r.ended_at,
                experimentId=r.experiment_id,
                eventCount=count,
            )
        )
    return out


@router.get(
    "/runs/{run_id}",
    response_model=RunSummary,
    response_model_by_alias=True,
)
async def get_run_summary(
    run_id: Annotated[RunId, Path()],
    session: Annotated[AsyncSession, Depends(session_scope)],
) -> RunSummary:
    r = (
        await session.execute(select(Run).where(Run.id == run_id))
    ).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=404, detail=f"run not found: {run_id}")
    count = await count_events_for_run(session, run_id)
    return RunSummary(
        runId=r.id,
        taskId=r.task_id,
        model=r.model,
        outcome=r.outcome,
        outcomeSource=normalize_outcome_source(r.outcome_source),
        totalTokens=r.total_tokens,
        totalCostUsd=r.total_cost_usd,
        startedAt=r.started_at,
        endedAt=r.ended_at,
        experimentId=r.experiment_id,
        eventCount=count,
    )
