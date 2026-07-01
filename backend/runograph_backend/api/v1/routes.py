"""GET /api/v1/routes/* — route-graph derivation + clustering endpoints.

Four endpoints in this router:

  GET /api/v1/routes/run/{run_id}                    single-run force-graph
  GET /api/v1/routes/aggregate?experiment=<id>       sum-across-runs graph
  GET /api/v1/routes/clusters?experiment=<id>        3-5 path families
  GET /api/v1/routes/touched-nodes?experiment=<id>   per-run touched-node sets
  GET /api/v1/routes/repo-tree?experiment=<id>       repo file tree + visits per file

All pull from the Phase-B SQLite trace store via SQLAlchemy. The repo
tree walks the on-disk snapshot at ~/.runograph/runs/<experiment>/runs/
<first-run>/repo and merges visits-per-target from the events table.
"""

from __future__ import annotations

import os
from pathlib import Path
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
    outcome: str | None = Query(None, description="pass|fail|error — narrow to runs with this outcome"),
    model: str | None = Query(None, description="exact model id match"),
    cost_min: float | None = Query(None, alias="costMin", ge=0.0),
    cost_max: float | None = Query(None, alias="costMax", ge=0.0),
    latency_min: float | None = Query(None, alias="latencyMin", ge=0.0),
    latency_max: float | None = Query(None, alias="latencyMax", ge=0.0),
    run_ids: str | None = Query(None, alias="runIds", description="comma-separated run id whitelist"),
) -> GraphOut:
    """Aggregate route graph for an experiment, optionally narrowed by filters.

    With no filters, returns the full-experiment aggregate (same as the
    `aggregateGraph` field on /clusters). When any filter narrows the run
    set, returns a freshly summed graph over the matching subset — this is
    what the frontend filter chips and distribution-strip brushes call.
    """
    runs = await _load_runs_for_experiment(session, experiment)
    if not runs:
        raise HTTPException(status_code=404, detail=f"no runs for experiment {experiment}")

    whitelist: set[str] | None = None
    if run_ids:
        whitelist = {rid.strip() for rid in run_ids.split(",") if rid.strip()}

    def keep(r: Run) -> bool:
        if whitelist is not None and r.id not in whitelist:
            return False
        if outcome and r.outcome != outcome:
            return False
        if model and r.model != model:
            return False
        if cost_min is not None and (r.total_cost_usd or 0.0) < cost_min:
            return False
        if cost_max is not None and (r.total_cost_usd or 0.0) > cost_max:
            return False
        if latency_min is not None or latency_max is not None:
            if r.started_at is None or r.ended_at is None:
                return False
            lat = (r.ended_at - r.started_at).total_seconds()
            if latency_min is not None and lat < latency_min:
                return False
            if latency_max is not None and lat > latency_max:
                return False
        return True

    selected = [r for r in runs if keep(r)]
    if not selected:
        # Empty filter result — return an empty graph rather than 404 so the
        # frontend can render a "no runs match" state inline.
        return GraphOut(nodes=[], edges=[], sequence_length=0, run_count=0)

    events_by_run = {r.id: await _load_events_for_run(session, r.id) for r in selected}
    outcomes_by_run = {r.id: (r.outcome or "") for r in selected}
    g = rg_mod.build_aggregate_graph(events_by_run, outcomes_by_run=outcomes_by_run)
    return _graph_to_out(g)


class TouchedNodesResponse(BaseModel):
    experiment_id: str = Field(..., alias="experimentId")
    # Map of run_id -> list of node ids (using the same _slug() rule as
    # route_graph so frontend ids match aggregate graph node ids exactly).
    touched: dict[str, list[str]]

    model_config = {"populate_by_name": True}


@router.get(
    "/touched-nodes",
    response_model=TouchedNodesResponse,
    response_model_by_alias=True,
)
async def get_touched_nodes(
    session: Annotated[AsyncSession, Depends(session_scope)],
    experiment: str = Query(...),
) -> TouchedNodesResponse:
    """Per-run touched-node set. Lets the aggregate page compute exact
    pass-rate-per-node colouring without 50 separate /run/{id} fetches.

    Returns one entry per run that captured at least one event with a
    non-null target. Empty-trace runs (no-route cluster) are omitted —
    they have no nodes to attribute to.
    """
    runs = await _load_runs_for_experiment(session, experiment)
    if not runs:
        raise HTTPException(status_code=404, detail=f"no runs for experiment {experiment}")

    touched: dict[str, list[str]] = {}
    for r in runs:
        events = await _load_events_for_run(session, r.id)
        seen: set[str] = set()
        ordered: list[str] = []
        for e in events:
            if not e.target:
                continue
            node_id = rg_mod._slug(e.target)
            if node_id in seen:
                continue
            seen.add(node_id)
            ordered.append(node_id)
        if ordered:
            touched[r.id] = ordered
    return TouchedNodesResponse(experiment_id=experiment, touched=touched)


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
    indicators_by_run: dict[str, dict[str, float]] = {}
    run_by_id = {r.id: r for r in runs}
    for r in runs:
        events = await _load_events_for_run(session, r.id)
        events_by_run[r.id] = events
        routes_by_run[r.id] = rg_mod.route_as_target_sequence(events)
        outcomes_by_run[r.id] = r.outcome
        indicators_by_run[r.id] = metrics_mod.run_indicators(
            outcome=r.outcome,
            total_tokens=r.total_tokens,
            total_cost_usd=r.total_cost_usd,
            started_at=r.started_at,
            ended_at=r.ended_at,
            events=events,
        )
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
        per_run_inds = [indicators_by_run[rid] for rid in member_ids]
        cluster_summaries.append(
            ClusterSummary(
                cluster_id=cid,
                size=len(member_ids),
                representative_run_id=rep_id,
                member_run_ids=member_ids,
                representative_graph=_graph_to_out(rep_graph),
                metrics=metrics_mod.group_stats(per_run_inds),
            )
        )

    aggregate = rg_mod.build_aggregate_graph(events_by_run, outcomes_by_run=outcomes_by_run)
    # Experiment-wide stats — every run whose trace was captured.
    experiment_stats = metrics_mod.group_stats(
        [ind for rid, ind in indicators_by_run.items() if events_by_run[rid]]
    )
    return ClustersResponse(
        experiment_id=experiment,
        k=cluster_res.k,
        clusters=cluster_summaries,
        aggregate_graph=_graph_to_out(aggregate),
        experiment_stats=experiment_stats,
    )


# ----- repo-tree endpoint -----


class RepoTreeNode(BaseModel):
    """Hierarchical file-tree node. Dirs carry roll-up totals; files carry leaf stats."""

    name: str
    kind: str  # "dir" or "file"
    # Leaf fields (kind == "file")
    path: str | None = None
    size: int | None = None
    visits: int = 0
    # Branch fields (kind == "dir")
    children: list["RepoTreeNode"] | None = None
    total_files: int = Field(0, alias="totalFiles")
    total_size: int = Field(0, alias="totalSize")
    total_visits: int = Field(0, alias="totalVisits")

    model_config = {"populate_by_name": True}


class RepoTreeResponse(BaseModel):
    experiment_id: str = Field(..., alias="experimentId")
    repo_root_name: str = Field(..., alias="repoRootName")
    tree: RepoTreeNode
    file_count: int = Field(..., alias="fileCount")
    touched_count: int = Field(..., alias="touchedCount")

    model_config = {"populate_by_name": True}


def _find_repo_root(experiment_id: str) -> Path | None:
    """Find the on-disk repo snapshot for an experiment.

    Layout: ~/.runograph/runs/<experiment_id>/runs/<run_id>/repo/. All runs
    in an experiment use the same base commit, so we walk the first run's
    snapshot. Returns None when the directory doesn't exist (cloud-only
    experiments will surface a graceful empty tree).
    """
    base = Path.home() / ".runograph" / "runs" / experiment_id / "runs"
    if not base.is_dir():
        return None
    for child in sorted(base.iterdir()):
        repo = child / "repo"
        if repo.is_dir():
            return repo
    return None


# Directories that should never appear in the tree — heavy, irrelevant to agent
# work, or risky to walk.
_REPO_TREE_SKIP_DIRS = {".git", "__pycache__", ".mypy_cache", ".pytest_cache", "node_modules", ".venv", "venv"}


def _walk_repo_tree(root: Path, visits_by_path: dict[str, int]) -> RepoTreeNode:
    """Walk the repo root into a hierarchical RepoTreeNode tree.

    Each directory aggregates its descendants' size + file-count + visits so
    the frontend can size treemap tiles without re-traversing.
    """

    def build(p: Path, rel: str) -> RepoTreeNode:
        if p.is_dir():
            children: list[RepoTreeNode] = []
            total_files = 0
            total_size = 0
            total_visits = 0
            try:
                entries = sorted(p.iterdir(), key=lambda e: (e.is_file(), e.name))
            except OSError:
                entries = []
            for child in entries:
                if child.name in _REPO_TREE_SKIP_DIRS:
                    continue
                if child.is_symlink():
                    continue
                child_rel = f"{rel}/{child.name}" if rel else child.name
                node = build(child, child_rel)
                children.append(node)
                if node.kind == "file":
                    total_files += 1
                    total_size += node.size or 0
                    total_visits += node.visits
                else:
                    total_files += node.total_files
                    total_size += node.total_size
                    total_visits += node.total_visits
            return RepoTreeNode(
                name=p.name if rel else "",
                kind="dir",
                children=children,
                total_files=total_files,
                total_size=total_size,
                total_visits=total_visits,
            )
        try:
            size = p.stat().st_size
        except OSError:
            size = 0
        return RepoTreeNode(
            name=p.name,
            kind="file",
            path=rel,
            size=size,
            visits=visits_by_path.get(rel, 0),
        )

    return build(root, "")


@router.get(
    "/repo-tree",
    response_model=RepoTreeResponse,
    response_model_by_alias=True,
)
async def get_repo_tree(
    session: Annotated[AsyncSession, Depends(session_scope)],
    experiment: str = Query(...),
) -> RepoTreeResponse:
    """Walk the experiment's repo snapshot and merge in per-file visit counts.

    Drives the repo-as-backdrop prototypes (treemap, directory-aware layout,
    side pane). All three want the same data so the endpoint returns the
    union: dir hierarchy + per-file size + per-file visit count.
    """
    repo_root = _find_repo_root(experiment)
    if repo_root is None:
        raise HTTPException(
            status_code=404,
            detail=f"no on-disk repo snapshot for experiment {experiment} "
            f"(expected at ~/.runograph/runs/{experiment}/runs/<run>/repo)",
        )

    # Aggregate visits by raw event target. We match the target against the
    # relative repo-path verbatim — non-path targets (bash commands like
    # "grep:msg-template") simply won't match any file, which is correct.
    runs = await _load_runs_for_experiment(session, experiment)
    visits_by_path: dict[str, int] = {}
    for r in runs:
        rows = (
            await session.execute(
                select(Event.target).where(Event.run_id == r.id)
            )
        ).scalars().all()
        for target in rows:
            if not target:
                continue
            visits_by_path[target] = visits_by_path.get(target, 0) + 1

    tree = _walk_repo_tree(repo_root, visits_by_path)
    touched_count = sum(1 for t in visits_by_path if (repo_root / t).is_file())
    return RepoTreeResponse(
        experiment_id=experiment,
        repo_root_name=repo_root.name,
        tree=tree,
        file_count=tree.total_files,
        touched_count=touched_count,
    )
