"""GET /api/v1/routes/* — route-graph derivation + clustering endpoints.

Three endpoints in this router:

  GET /api/v1/routes/run/{run_id}                    single-run route graph
  GET /api/v1/routes/aggregate?experiment=<id>       sum-across-runs graph
  GET /api/v1/routes/clusters?experiment=<id>        path families

All pull from the SQLite trace store via SQLAlchemy.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from runograph_backend.analysis import metrics as metrics_mod
from runograph_backend.analysis import route_graph as rg_mod
from runograph_backend.analysis import run_filter
from runograph_backend.analysis import tables as tables_mod
from runograph_backend.storage.db import session_scope
from runograph_backend.storage.models import Run

router = APIRouter(prefix="/api/v1/routes", tags=["routes"])


# ----- response models -----


class NodeOut(BaseModel):
    id: str
    target: str
    kind: str
    visits: int
    avg_tokens: float = Field(..., alias="avgTokens")
    avg_time_seconds: float = Field(..., alias="avgTimeSeconds")
    error_count: int = Field(0, alias="errorCount")

    model_config = {"populate_by_name": True}


class EdgeOut(BaseModel):
    source: str
    target: str
    count: int
    total_time_seconds: float = Field(..., alias="totalTimeSeconds")
    # Conformance counts — RUNS that traversed this edge AND passed/failed.
    # Both 0 when the aggregator was called without outcomes_by_run (single-
    # run graphs, or aggregate calls before Mode E went live). Frontend Mode
    # E uses these to classify edges as pass-only / fail-only / shared.
    pass_count: int = Field(0, alias="passCount")
    fail_count: int = Field(0, alias="failCount")

    model_config = {"populate_by_name": True}


class GraphOut(BaseModel):
    nodes: list[NodeOut]
    edges: list[EdgeOut]
    sequence_length: int = Field(..., alias="sequenceLength")
    run_count: int = Field(1, alias="runCount")

    model_config = {"populate_by_name": True}


class RouteRunResponse(BaseModel):
    run_id: str = Field(..., alias="runId")
    task_id: str = Field(..., alias="taskId")
    model: str
    outcome: str
    graph: GraphOut
    metrics: dict[str, float]

    model_config = {"populate_by_name": True}


class ClusterSummary(BaseModel):
    cluster_id: int = Field(..., alias="clusterId")
    size: int
    representative_run_id: str = Field(..., alias="representativeRunId")
    member_run_ids: list[str] = Field(..., alias="memberRunIds")
    representative_graph: GraphOut = Field(..., alias="representativeGraph")
    metrics: dict[str, float]

    model_config = {"populate_by_name": True}


class ClustersResponse(BaseModel):
    experiment_id: str = Field(..., alias="experimentId")
    k: int
    clusters: list[ClusterSummary]
    aggregate_graph: GraphOut = Field(..., alias="aggregateGraph")
    # Experiment-wide group_stats: distribution stats computed over every
    # run with at least one event. Frontend reads this for the overview
    # metrics card and for per-cluster baseline deltas.
    experiment_stats: dict[str, float] = Field(..., alias="experimentStats")

    model_config = {"populate_by_name": True}


# ----- helpers -----

# Row loading lives in analysis.tables so the CSV export and this router
# share one implementation.
_load_events_for_run = tables_mod.load_events_for_run


def _node_to_out(n: rg_mod.GraphNode) -> NodeOut:
    return NodeOut(
        id=n.id,
        target=n.target,
        kind=n.kind,
        visits=n.visits,
        avg_tokens=n.avg_tokens,
        avg_time_seconds=n.avg_time_seconds,
        error_count=n.error_count,
    )


def _edge_to_out(e: rg_mod.GraphEdge) -> EdgeOut:
    return EdgeOut(
        source=e.source,
        target=e.target,
        count=e.count,
        total_time_seconds=e.total_time_seconds,
        pass_count=e.pass_count,
        fail_count=e.fail_count,
    )


def _graph_to_out(g: rg_mod.RouteGraph) -> GraphOut:
    return GraphOut(
        nodes=[_node_to_out(n) for n in g.nodes],
        edges=[_edge_to_out(e) for e in g.edges],
        sequence_length=g.sequence_length,
        run_count=g.run_count,
    )


# ----- endpoints -----


@router.get("/run/{run_id}", response_model=RouteRunResponse, response_model_by_alias=True)
async def get_run_route(
    run_id: str,
    session: Annotated[AsyncSession, Depends(session_scope)],
) -> RouteRunResponse:
    run = (
        await session.execute(select(Run).where(Run.id == run_id))
    ).scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail=f"run not found: {run_id}")

    events = await _load_events_for_run(session, run_id)
    graph = rg_mod.build_run_graph(events)
    metrics = metrics_mod.run_indicators(
        outcome=run.outcome,
        total_tokens=run.total_tokens,
        total_cost_usd=run.total_cost_usd,
        started_at=run.started_at,
        ended_at=run.ended_at,
        events=events,
    )
    return RouteRunResponse(
        run_id=run.id,
        task_id=run.task_id,
        model=run.model,
        outcome=run.outcome,
        graph=_graph_to_out(graph),
        metrics=metrics,
    )


@router.get("/aggregate", response_model=GraphOut, response_model_by_alias=True)
async def get_aggregate_route(
    session: Annotated[AsyncSession, Depends(session_scope)],
    experiment: str = Query(...),
    s: Annotated[list[str] | None, Query(alias="s")] = None,
    outcome: str | None = Query(None, description="DEPRECATED alias for s=outcome:eq:…"),
    model: str | None = Query(None, description="DEPRECATED alias for s=model:eq:…"),
    cost_min: float | None = Query(None, alias="costMin", ge=0.0, description="DEPRECATED alias"),
    cost_max: float | None = Query(None, alias="costMax", ge=0.0, description="DEPRECATED alias"),
    latency_min: float | None = Query(None, alias="latencyMin", ge=0.0, description="DEPRECATED alias"),
    latency_max: float | None = Query(None, alias="latencyMax", ge=0.0, description="DEPRECATED alias"),
    run_ids: str | None = Query(None, alias="runIds", description="comma-separated run id whitelist"),
) -> GraphOut:
    """Aggregate route graph for an experiment, optionally narrowed to a
    run scope.

    Native filtering is `s=` filter-grammar predicates (shared with
    /api/v1/tables/*). The individual query params are deprecated aliases
    translated to predicates internally; note runs with missing timestamps
    evaluate as latency_s == 0.0 under the shared evaluator.
    """
    data = await tables_mod.load_experiment_data(session, experiment)
    if not data.runs:
        raise HTTPException(status_code=404, detail=f"no runs for experiment {experiment}")

    legacy: list[str] = []
    if outcome:
        legacy.append(f"outcome:eq:{outcome}")
    if model:
        legacy.append(f"model:eq:{model}")
    if cost_min is not None:
        legacy.append(f"total_cost_usd:gte:{cost_min}")
    if cost_max is not None:
        legacy.append(f"total_cost_usd:lte:{cost_max}")
    if latency_min is not None:
        legacy.append(f"latency_s:gte:{latency_min}")
    if latency_max is not None:
        legacy.append(f"latency_s:lte:{latency_max}")

    try:
        preds = run_filter.parse_filters((s or []) + legacy)
        run_filter.validate_predicates(preds, tables_mod.COLUMN_KINDS["runs"])
        whitelist = run_filter.parse_run_whitelist(run_ids)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    scoped_data = data
    if preds or whitelist is not None:
        run_rows = tables_mod.build_run_rows(data, tables_mod.compute_clusters(data))
        ids = run_filter.scoped_run_ids(data, run_rows, preds, whitelist)
        if not ids:
            # Empty filter result — return an empty graph rather than 404 so
            # the frontend can render a "no runs match" state inline.
            return GraphOut(nodes=[], edges=[], sequence_length=0, run_count=0)
        scoped_data = run_filter.narrow(data, ids)

    g = rg_mod.build_aggregate_graph(
        scoped_data.events_by_run, outcomes_by_run=scoped_data.outcomes_by_run
    )
    return _graph_to_out(g)


@router.get(
    "/clusters",
    response_model=ClustersResponse,
    response_model_by_alias=True,
)
async def get_clusters(
    session: Annotated[AsyncSession, Depends(session_scope)],
    experiment: str = Query(...),
    k_min: int = Query(2, ge=2, le=15),
    k_max: int = Query(12, ge=2, le=15),
) -> ClustersResponse:
    if k_max < k_min:
        raise HTTPException(status_code=400, detail="k_max must be >= k_min")

    data = await tables_mod.load_experiment_data(session, experiment)
    if not data.runs:
        raise HTTPException(status_code=404, detail=f"no runs for experiment {experiment}")

    # Shared with the CSV export / table API — same seed, same assignments.
    comp = tables_mod.compute_clusters(data, k_range=(k_min, k_max))
    indicators = tables_mod.indicators_by_run(data)

    cluster_summaries: list[ClusterSummary] = []
    for cid in sorted(comp.members):
        member_ids = comp.members[cid]
        rep_id = comp.representative_by_cluster[cid]
        rep_graph = rg_mod.build_run_graph(data.events_by_run[rep_id])
        cluster_summaries.append(
            ClusterSummary(
                cluster_id=cid,
                size=len(member_ids),
                representative_run_id=rep_id,
                member_run_ids=member_ids,
                representative_graph=_graph_to_out(rep_graph),
                metrics=metrics_mod.group_stats(
                    [indicators[rid] for rid in member_ids]
                ),
            )
        )

    aggregate = rg_mod.build_aggregate_graph(
        data.events_by_run, outcomes_by_run=data.outcomes_by_run
    )
    # Experiment-wide stats — every run whose trace was captured.
    experiment_stats = metrics_mod.group_stats(
        [ind for rid, ind in indicators.items() if data.events_by_run[rid]]
    )
    return ClustersResponse(
        experiment_id=experiment,
        k=comp.k,
        clusters=cluster_summaries,
        aggregate_graph=_graph_to_out(aggregate),
        experiment_stats=experiment_stats,
    )
