"""GET /api/v1/runs  and  POST /api/v1/runs/ingest.

Lists captured runs and ingests a run-dir into the trace store. v0.3 alpha
accepts an absolute path in the POST body since the orchestrator runs on
the same machine as the FastAPI server; a multipart-upload variant lands
when remote sim runners come online (deferred to v0.4+).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ...storage.db import AsyncSessionLocal
from ...storage.ingest import count_events_for_run, ingest_run
from ...storage.models import Event, Run
from ...storage.schemas import IngestRequest, IngestResponse, RunSummary

router = APIRouter(prefix="/api/v1", tags=["runs"])


@router.post(
    "/runs/ingest",
    response_model=IngestResponse,
    response_model_by_alias=True,
)
async def post_ingest(req: IngestRequest) -> IngestResponse:
    run_dir = Path(req.run_dir).expanduser().resolve()
    if not run_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"run_dir not found: {run_dir}")
    async with AsyncSessionLocal() as session:
        run_id, events_ingested = await ingest_run(session, run_dir)
    return IngestResponse(runId=run_id, eventsIngested=events_ingested)


@router.get(
    "/runs",
    response_model=list[RunSummary],
    response_model_by_alias=True,
)
async def list_runs(experiment_id: str | None = None) -> list[RunSummary]:
    async with AsyncSessionLocal() as session:
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
async def get_run_summary(run_id: str) -> RunSummary:
    async with AsyncSessionLocal() as session:
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
        totalTokens=r.total_tokens,
        totalCostUsd=r.total_cost_usd,
        startedAt=r.started_at,
        endedAt=r.ended_at,
        experimentId=r.experiment_id,
        eventCount=count,
    )
