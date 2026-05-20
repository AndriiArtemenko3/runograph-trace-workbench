"""GET /api/v1/routes/* — route-graph derivation + clustering endpoints.

Three endpoints in this router:

  GET /api/v1/routes/run/{run_id}
      Single-run force-graph + per-run metrics.

  GET /api/v1/routes/aggregate?experiment=<id>
      Sum-across-runs graph (used as the page header overlay).

  GET /api/v1/routes/clusters?experiment=<id>
      3-5 path families with representative run + cluster-level metrics.

All three pull from the Phase-B SQLite trace store via SQLAlchemy. Heavy
clustering happens on-request; the 50 × 50 Levenshtein pairs run in
under a second, so pre-computing into route_cluster table is unnecessary
for v0.3.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from runograph_backend.analysis import cluster as cluster_mod
from runograph_backend.analysis import metrics as metrics_mod
from runograph_backend.analysis import route_graph as rg_mod
from runograph_backend.storage.db import session_scope
from runograph_backend.storage.models import Event, Run
from runograph_backend.storage.schemas import CanonicalEvent, EventCost

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

    model_config = {"populate_by_name": True}


# ----- helpers -----


def _event_row_to_canonical(row: Event) -> CanonicalEvent:
    return CanonicalEvent(
        event_id=row.event_id,
        timestamp=row.ts,
        type=row.type,  # type: ignore[arg-type]
        target=row.target,
        content_summary=row.content_summary,
        cost=EventCost(tokens=row.tokens, time_seconds=row.time_seconds),
        parent_event_id=row.parent_event_id,
        task_relevance_score=row.task_relevance_score,
    )


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
    )


def _graph_to_out(g: rg_mod.RouteGraph) -> GraphOut:
    return GraphOut(
        nodes=[_node_to_out(n) for n in g.nodes],
        edges=[_edge_to_out(e) for e in g.edges],
        sequence_length=g.sequence_length,
        run_count=g.run_count,
    )


async def _load_events_for_run(session: AsyncSession, run_id: str) -> list[CanonicalEvent]:
    rows = (
        await session.execute(
            select(Event).where(Event.run_id == run_id).order_by(Event.ts)
        )
    ).scalars().all()
    return [_event_row_to_canonical(r) for r in rows]


async def _load_runs_for_experiment(
    session: AsyncSession, experiment_id: str
) -> list[Run]:
    rows = (
        await session.execute(
            select(Run).where(Run.experiment_id == experiment_id)
        )
    ).scalars().all()
    return list(rows)


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
    metrics = metrics_mod.compute_all(
        events=events,
        edges=graph.edges,
        passed=(run.outcome == "pass"),
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
) -> GraphOut:
    runs = await _load_runs_for_experiment(session, experiment)
    if not runs:
        raise HTTPException(status_code=404, detail=f"no runs for experiment {experiment}")
    events_by_run = {r.id: await _load_events_for_run(session, r.id) for r in runs}
    g = rg_mod.build_aggregate_graph(events_by_run)
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

    runs = await _load_runs_for_experiment(session, experiment)
    if not runs:
        raise HTTPException(status_code=404, detail=f"no runs for experiment {experiment}")

    events_by_run: dict[str, list[CanonicalEvent]] = {}
    routes_by_run: dict[str, list[str]] = {}
    outcomes_by_run: dict[str, str] = {}
    features_by_run: dict[str, cluster_mod.RunFeatures] = {}
    for r in runs:
        events = await _load_events_for_run(session, r.id)
        events_by_run[r.id] = events
        routes_by_run[r.id] = rg_mod.route_as_target_sequence(events)
        outcomes_by_run[r.id] = r.outcome
        if events:
            features_by_run[r.id] = cluster_mod.RunFeatures(
                event_types=[e.type for e in events],
                unique_target_count=len({e.target for e in events if e.target}),
                outcome=r.outcome,
                total_tokens=r.total_tokens or 0,
                total_cost_usd=r.total_cost_usd or 0.0,
            )

    # Skip runs with empty traces from clustering input; report them separately
    # as a "no-route" cluster_id=0.
    cluster_res = cluster_mod.cluster_routes(features_by_run, k_range=(k_min, k_max))

    # Group runs by cluster
    members: dict[int, list[str]] = {}
    distances: dict[str, float] = {}
    for a in cluster_res.assignments:
        members.setdefault(a.cluster_id, []).append(a.run_id)
        distances[a.run_id] = a.distance_to_centroid
    # Empty-route runs become cluster 0 (no-route)
    empty_runs = [rid for rid, seq in routes_by_run.items() if not seq]
    if empty_runs:
        members[0] = empty_runs

    cluster_summaries: list[ClusterSummary] = []
    for cid in sorted(members):
        member_ids = members[cid]
        if cid == 0:
            rep_id = member_ids[0]
        else:
            rep_id = cluster_res.centroids_by_cluster[cid]
        rep_events = events_by_run[rep_id]
        rep_graph = rg_mod.build_run_graph(rep_events)
        per_run_m = [
            metrics_mod.compute_all(
                events=events_by_run[rid],
                edges=rg_mod.build_run_graph(events_by_run[rid]).edges,
                passed=(outcomes_by_run[rid] == "pass"),
            )
            for rid in member_ids
        ]
        cluster_summaries.append(
            ClusterSummary(
                cluster_id=cid,
                size=len(member_ids),
                representative_run_id=rep_id,
                member_run_ids=member_ids,
                representative_graph=_graph_to_out(rep_graph),
                metrics=metrics_mod.aggregate_metrics(per_run_m),
            )
        )

    aggregate = rg_mod.build_aggregate_graph(events_by_run)
    return ClustersResponse(
        experiment_id=experiment,
        k=cluster_res.k,
        clusters=cluster_summaries,
        aggregate_graph=_graph_to_out(aggregate),
    )
