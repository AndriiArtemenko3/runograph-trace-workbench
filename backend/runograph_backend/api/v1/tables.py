"""Flat JSON tables for the workbench UI.

GET /api/v1/experiments            experiment ids + run counts (picker)
GET /api/v1/tables/{sheet}?experiment=<id>[&s=<pred>...][&runs=<csv>]
                                   sheet = runs | steps | clusters | edges

Rows come straight from analysis.tables' builders, so keys match the CSV
export column-for-column (snake_case in both surfaces).

Run scope: `s=` takes filter-grammar predicates over runs-sheet columns
(route.* pseudo-columns allowed); `runs=` is a run-id whitelist; both
present → intersection. Scope semantics per sheet: runs/steps rows are
narrowed; edges are RECOMPUTED over the subset; clusters keep their
experiment-global assignments and re-aggregate stats over scoped members.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from runograph_backend.analysis import run_filter
from runograph_backend.analysis import tables as tables_mod
from runograph_backend.storage.db import session_scope
from runograph_backend.storage.models import Run
from runograph_backend.storage.schemas import ExperimentId, is_public_id

router = APIRouter(prefix="/api/v1", tags=["tables"])

Sheet = Literal["runs", "steps", "clusters", "edges"]


@router.get("/experiments")
async def list_experiments(
    session: Annotated[AsyncSession, Depends(session_scope)],
) -> list[dict]:
    rows = (
        await session.execute(
            select(Run.experiment_id, func.count(Run.id))
            .where(Run.experiment_id.is_not(None), Run.experiment_id != "")
            .group_by(Run.experiment_id)
            .order_by(Run.experiment_id)
        )
    ).all()
    # Unsafe legacy identifiers remain available to the local export/re-ingest
    # recovery path but are not advertised into a URL-based picker that cannot
    # represent them faithfully.
    return [
        {"experiment_id": eid, "run_count": n}
        for eid, n in rows
        if is_public_id(eid)
    ]


@router.get("/tables/{sheet}")
async def get_table(
    sheet: Sheet,
    session: Annotated[AsyncSession, Depends(session_scope)],
    experiment: Annotated[ExperimentId, Query()],
    s: Annotated[list[str] | None, Query(alias="s")] = None,
    runs: str | None = Query(None, description="comma-separated run-id whitelist"),
) -> list[dict]:
    data = await tables_mod.load_experiment_data(session, experiment)
    if not data.runs:
        raise HTTPException(status_code=404, detail=f"no runs for experiment {experiment}")

    try:
        preds = run_filter.parse_filters(s or [])
        run_filter.validate_predicates(preds, tables_mod.COLUMN_KINDS["runs"])
        whitelist = run_filter.parse_run_whitelist(runs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Clustering is needed for run rows, cluster rows, and any scoped
    # request (scope predicates may reference cluster_id / z columns) —
    # compute once, lazily, so unscoped steps/edges skip the k-means sweep.
    clusters_cache: list[tables_mod.ClusterComputation] = []

    def clusters() -> tables_mod.ClusterComputation:
        if not clusters_cache:
            clusters_cache.append(tables_mod.compute_clusters(data))
        return clusters_cache[0]

    scoped: set[str] | None = None
    if preds or whitelist is not None:
        run_rows = tables_mod.build_run_rows(data, clusters())
        scoped = run_filter.scoped_run_ids(data, run_rows, preds, whitelist)

    if sheet == "runs":
        # Rows built on FULL data (cluster ids + z baselines stay global),
        # then narrowed to the scope.
        rows = tables_mod.build_run_rows(data, clusters())
        return [r for r in rows if scoped is None or r["run_id"] in scoped]
    if sheet == "steps":
        rows = tables_mod.build_step_rows(data)
        return [r for r in rows if scoped is None or r["run_id"] in scoped]
    if sheet == "clusters":
        return tables_mod.build_cluster_rows(data, clusters(), scope_ids=scoped)
    # edges: aggregate recomputed over the scoped subset
    edge_data = run_filter.narrow(data, scoped) if scoped is not None else data
    return tables_mod.build_edge_rows(edge_data)
