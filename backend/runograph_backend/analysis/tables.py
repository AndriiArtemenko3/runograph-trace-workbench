"""Flat-table row builders over the trace store — the single source of truth
for both the CSV export CLI (scripts/export_runs.py) and the JSON table API.

Four grains, one row-builder each:

  runs        one row per run: real indicators + cluster assignment
  route_steps one row per (run, targeted event): long-form route sequence
  clusters    one row per cluster: group_stats() distribution
  edges       one row per target->target transition: counts + pass/fail split

All values are raw counts, tokens, seconds, and dollars — no composite
scores. Column constants define the CSV header order and the API contract;
keys are snake_case in both surfaces so they can never diverge.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from runograph_backend.analysis import cluster as cluster_mod
from runograph_backend.analysis import metrics as metrics_mod
from runograph_backend.analysis import route_graph as rg_mod
from runograph_backend.storage.models import Event, Run
from runograph_backend.storage.schemas import CanonicalEvent, EventCost

# ----- loading -----


@dataclass
class ExperimentData:
    """Everything the builders need, loaded once per experiment."""

    experiment_id: str
    runs: list[Run]
    events_by_run: dict[str, list[CanonicalEvent]]

    @property
    def outcomes_by_run(self) -> dict[str, str]:
        return {r.id: (r.outcome or "") for r in self.runs}


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


async def load_events_for_run(
    session: AsyncSession, run_id: str
) -> list[CanonicalEvent]:
    rows = (
        await session.execute(
            select(Event).where(Event.run_id == run_id).order_by(Event.ts)
        )
    ).scalars().all()
    return [_event_row_to_canonical(r) for r in rows]


async def load_runs_for_experiment(
    session: AsyncSession, experiment_id: str
) -> list[Run]:
    rows = (
        await session.execute(
            select(Run).where(Run.experiment_id == experiment_id)
        )
    ).scalars().all()
    return list(rows)


async def load_experiment_data(
    session: AsyncSession, experiment_id: str
) -> ExperimentData:
    runs = await load_runs_for_experiment(session, experiment_id)
    events_by_run = {r.id: await load_events_for_run(session, r.id) for r in runs}
    return ExperimentData(
        experiment_id=experiment_id, runs=runs, events_by_run=events_by_run
    )


def indicators_by_run(data: ExperimentData) -> dict[str, dict[str, float]]:
    """metrics.run_indicators() for every run in the experiment."""
    return {
        r.id: metrics_mod.run_indicators(
            outcome=r.outcome,
            total_tokens=r.total_tokens,
            total_cost_usd=r.total_cost_usd,
            started_at=r.started_at,
            ended_at=r.ended_at,
            events=data.events_by_run[r.id],
        )
        for r in data.runs
    }


# ----- clustering -----


@dataclass
class ClusterComputation:
    """Deterministic cluster assignment for one experiment.

    The route_cluster table is not populated, so clustering runs on the fly
    with a fixed seed — every caller (CSV export, /routes/clusters, table
    API) goes through this function and therefore agrees on assignments.
    Cluster 0 collects runs with no captured events ("no-route").
    """

    k: int
    members: dict[int, list[str]]
    assignment_by_run: dict[str, cluster_mod.ClusterAssignment]
    representative_by_cluster: dict[int, str]


def compute_clusters(
    data: ExperimentData, k_range: tuple[int, int] = (2, 12)
) -> ClusterComputation:
    features_by_run: dict[str, cluster_mod.RunFeatures] = {}
    for r in data.runs:
        events = data.events_by_run[r.id]
        if not events:
            continue
        features_by_run[r.id] = cluster_mod.RunFeatures(
            event_types=[e.type for e in events],
            unique_target_count=len({e.target for e in events if e.target}),
            outcome=r.outcome,
            total_tokens=r.total_tokens or 0,
            total_cost_usd=r.total_cost_usd or 0.0,
        )

    result = cluster_mod.cluster_routes(features_by_run, k_range=k_range)

    members: dict[int, list[str]] = {}
    assignment_by_run: dict[str, cluster_mod.ClusterAssignment] = {}
    for a in result.assignments:
        members.setdefault(a.cluster_id, []).append(a.run_id)
        assignment_by_run[a.run_id] = a

    no_route = [r.id for r in data.runs if r.id not in assignment_by_run]
    if no_route:
        members[0] = no_route

    representative_by_cluster = dict(result.centroids_by_cluster)
    if no_route:
        representative_by_cluster[0] = no_route[0]

    return ClusterComputation(
        k=result.k,
        members=members,
        assignment_by_run=assignment_by_run,
        representative_by_cluster=representative_by_cluster,
    )


# ----- row builders -----


RUNS_COLUMNS = (
    "run_id",
    "task_id",
    "model",
    "outcome",
    "total_tokens",
    "total_cost_usd",
    "latency_s",
    "event_count",
    "tool_call_count",
    "unique_targets",
    "error_count",
    "cluster_id",
    "distance_to_centroid",
    "is_representative",
)

STEPS_COLUMNS = (
    "run_id",
    "seq_idx",
    "event_type",
    "target",
    "tokens",
    "time_seconds",
)

_CLUSTER_STAT_FIELDS = ("cost_usd", "tokens_total", "latency_s", "event_count")
_CLUSTER_STAT_SUFFIXES = ("mean", "median", "p95", "std")

CLUSTERS_COLUMNS = (
    "cluster_id",
    "n_runs",
    "representative_run_id",
    "pass_rate",
    "error_rate",
) + tuple(
    f"{field}_{suffix}"
    for field in _CLUSTER_STAT_FIELDS
    for suffix in _CLUSTER_STAT_SUFFIXES
)

EDGES_COLUMNS = (
    "source",
    "target",
    "count",
    "pass_count",
    "fail_count",
    "total_time_seconds",
)


def _round(v: float) -> float:
    return round(float(v), 6)


def build_run_rows(
    data: ExperimentData, clusters: ClusterComputation
) -> list[dict]:
    inds = indicators_by_run(data)
    rows: list[dict] = []
    for r in sorted(data.runs, key=lambda r: r.id):
        ind = inds[r.id]
        a = clusters.assignment_by_run.get(r.id)
        cluster_id = a.cluster_id if a else 0
        rows.append(
            {
                "run_id": r.id,
                "task_id": r.task_id,
                "model": r.model,
                "outcome": r.outcome,
                "total_tokens": int(ind["tokens_total"]),
                "total_cost_usd": _round(ind["cost_usd"]),
                "latency_s": _round(ind["latency_s"]),
                "event_count": int(ind["event_count"]),
                "tool_call_count": int(ind["tool_call_count"]),
                "unique_targets": int(ind["unique_targets"]),
                "error_count": int(ind["error_count"]),
                "cluster_id": cluster_id,
                "distance_to_centroid": _round(a.distance_to_centroid) if a else 0.0,
                "is_representative": clusters.representative_by_cluster.get(cluster_id)
                == r.id,
            }
        )
    return rows


def build_step_rows(data: ExperimentData) -> list[dict]:
    rows: list[dict] = []
    for run_id in sorted(data.events_by_run):
        route = rg_mod.events_to_route(data.events_by_run[run_id])
        for seq_idx, evt in enumerate(route):
            rows.append(
                {
                    "run_id": run_id,
                    "seq_idx": seq_idx,
                    "event_type": evt.type,
                    "target": evt.target or "",
                    "tokens": evt.cost.tokens,
                    "time_seconds": _round(evt.cost.time_seconds),
                }
            )
    return rows


def build_cluster_rows(
    data: ExperimentData, clusters: ClusterComputation
) -> list[dict]:
    inds = indicators_by_run(data)
    rows: list[dict] = []
    for cid in sorted(clusters.members):
        member_ids = clusters.members[cid]
        stats = metrics_mod.group_stats([inds[rid] for rid in member_ids])
        row: dict = {
            "cluster_id": cid,
            "n_runs": len(member_ids),
            "representative_run_id": clusters.representative_by_cluster.get(cid, ""),
            "pass_rate": _round(stats.get("pass_rate", 0.0)),
            "error_rate": _round(stats.get("error_rate", 0.0)),
        }
        for field in _CLUSTER_STAT_FIELDS:
            for suffix in _CLUSTER_STAT_SUFFIXES:
                row[f"{field}_{suffix}"] = _round(stats.get(f"{field}_{suffix}", 0.0))
        rows.append(row)
    return rows


def build_edge_rows(data: ExperimentData) -> list[dict]:
    graph = rg_mod.build_aggregate_graph(
        data.events_by_run, outcomes_by_run=data.outcomes_by_run
    )
    target_by_slug = {n.id: n.target for n in graph.nodes}
    rows = [
        {
            "source": target_by_slug.get(e.source, e.source),
            "target": target_by_slug.get(e.target, e.target),
            "count": e.count,
            "pass_count": e.pass_count,
            "fail_count": e.fail_count,
            "total_time_seconds": _round(e.total_time_seconds),
        }
        for e in graph.edges
    ]
    rows.sort(key=lambda r: (-r["count"], r["source"], r["target"]))
    return rows
