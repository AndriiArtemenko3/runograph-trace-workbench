"""Flat JSON tables for the workbench UI.

GET /api/v1/experiments            experiment ids + run counts (picker)
GET /api/v1/tables/{sheet}?experiment=<id>
                                   sheet = runs | steps | clusters | edges

Rows come straight from analysis.tables' builders, so keys match the CSV
export column-for-column (snake_case in both surfaces).
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from runograph_backend.analysis import tables as tables_mod
from runograph_backend.storage.db import session_scope
from runograph_backend.storage.models import Run

router = APIRouter(prefix="/api/v1", tags=["tables"])

Sheet = Literal["runs", "steps", "clusters", "edges"]


@router.get("/experiments")
async def list_experiments(
    session: Annotated[AsyncSession, Depends(session_scope)],
) -> list[dict]:
    rows = (
        await session.execute(
            select(Run.experiment_id, func.count(Run.id))
            .group_by(Run.experiment_id)
            .order_by(Run.experiment_id)
        )
    ).all()
    return [{"experiment_id": eid, "run_count": n} for eid, n in rows]


@router.get("/tables/{sheet}")
async def get_table(
    sheet: Sheet,
    session: Annotated[AsyncSession, Depends(session_scope)],
    experiment: str = Query(...),
) -> list[dict]:
    data = await tables_mod.load_experiment_data(session, experiment)
    if not data.runs:
        raise HTTPException(status_code=404, detail=f"no runs for experiment {experiment}")

    if sheet == "runs":
        return tables_mod.build_run_rows(data, tables_mod.compute_clusters(data))
    if sheet == "steps":
        return tables_mod.build_step_rows(data)
    if sheet == "clusters":
        return tables_mod.build_cluster_rows(data, tables_mod.compute_clusters(data))
    return tables_mod.build_edge_rows(data)
