"""Flat-table row builders over the trace store — the single source of truth
for both the CSV export CLI (scripts/export_runs.py) and the JSON table API.

Four grains, one row-builder each:

  runs        one row per run: real indicators + cluster assignment
  route_steps one row per (run, targeted event): long-form route sequence
  clusters    one row per cluster: distributions + imported-label summaries
  edges       one row per transition: counts + imported-label comparison

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
from runograph_backend.storage.schemas import (
    CanonicalEvent,
    EventCost,
    OutcomeLabelSource,
    normalize_outcome_source,
)

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


def outcome_label_source(
    data: ExperimentData, run_ids: set[str] | None = None
) -> OutcomeLabelSource:
    """Summarize persisted label provenance for a run scope.

    Empty scopes are ``none``. A scope with both current external imports and
    legacy/unknown rows is ``mixed``; unexpected stored values are treated as
    unknown rather than trusted.
    """
    sources = {
        normalize_outcome_source(run.outcome_source)
        for run in data.runs
        if run_ids is None or run.id in run_ids
    }
    if not sources:
        return "none"
    if len(sources) > 1:
        return "mixed"
    return sources.pop()


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
            select(Event).where(Event.run_id == run_id).order_by(Event.ts, Event.id)
        )
    ).scalars().all()
    return [_event_row_to_canonical(r) for r in rows]


async def load_runs_for_experiment(
    session: AsyncSession, experiment_id: str
) -> list[Run]:
    rows = (
        await session.execute(
            select(Run).where(Run.experiment_id == experiment_id).order_by(Run.id)
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


def indicators_by_run(data: ExperimentData) -> dict[str, dict[str, float | None]]:
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
    for r in sorted(data.runs, key=lambda run: run.id):
        events = data.events_by_run[r.id]
        if not events:
            continue
        features_by_run[r.id] = cluster_mod.RunFeatures(
            event_types=[e.type for e in events],
            unique_target_count=len({e.target for e in events if e.target}),
            event_tokens=sum(max(0, e.cost.tokens) for e in events),
            event_time_seconds=sum(max(0.0, e.cost.time_seconds) for e in events),
        )

    result = cluster_mod.cluster_routes(features_by_run, k_range=k_range)

    members: dict[int, list[str]] = {}
    assignment_by_run: dict[str, cluster_mod.ClusterAssignment] = {}
    for a in result.assignments:
        members.setdefault(a.cluster_id, []).append(a.run_id)
        assignment_by_run[a.run_id] = a
    for member_ids in members.values():
        member_ids.sort()

    no_route = sorted(r.id for r in data.runs if r.id not in assignment_by_run)
    if no_route:
        members[0] = no_route

    representative_by_cluster = dict(result.centroids_by_cluster)
    if no_route:
        representative_by_cluster[0] = min(no_route)

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
    "outcome_source",
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
    # z-scores vs the run's own cluster (full-experiment baselines; never
    # change under scoping). Standard scores of raw indicators.
    "cost_usd_z",
    "tokens_total_z",
    "latency_s_z",
    "event_count_z",
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
    "outcome_label_source",
    "reported_pass_rate",
    "reported_error_rate",
    *(
        f"{field}_{suffix}"
        for field in _CLUSTER_STAT_FIELDS
        for suffix in _CLUSTER_STAT_SUFFIXES
    ),
)

EDGES_COLUMNS = (
    "source",
    "target",
    "count",
    "outcome_label_source",
    "reported_pass_count",
    "reported_fail_count",
    "reported_error_count",
    "total_time_seconds",
)

# Column -> kind registry driving filter validation + coercion (run_filter.py
# backend-side, filters/predicate.ts client-side). Keys must exactly match
# the *_COLUMNS constants — locked by test.
COLUMN_KINDS: dict[str, dict[str, str]] = {
    "runs": {
        "run_id": "string",
        "task_id": "string",
        "model": "enum",
        "outcome": "enum",
        "outcome_source": "enum",
        "total_tokens": "number",
        "total_cost_usd": "number",
        "latency_s": "number",
        "event_count": "number",
        "tool_call_count": "number",
        "unique_targets": "number",
        "error_count": "number",
        "cluster_id": "enum",
        "distance_to_centroid": "number",
        "is_representative": "boolean",
        "cost_usd_z": "number",
        "tokens_total_z": "number",
        "latency_s_z": "number",
        "event_count_z": "number",
    },
    "steps": {
        "run_id": "string",
        "seq_idx": "number",
        "event_type": "enum",
        "target": "string",
        "tokens": "number",
        "time_seconds": "number",
    },
    "clusters": {
        "cluster_id": "enum",
        "n_runs": "number",
        "representative_run_id": "string",
        "outcome_label_source": "enum",
        "reported_pass_rate": "number",
        "reported_error_rate": "number",
        **{
            f"{field}_{suffix}": "number"
            for field in _CLUSTER_STAT_FIELDS
            for suffix in _CLUSTER_STAT_SUFFIXES
        },
    },
    "edges": {
        "source": "string",
        "target": "string",
        "count": "number",
        "outcome_label_source": "enum",
        "reported_pass_count": "number",
        "reported_fail_count": "number",
        "reported_error_count": "number",
        "total_time_seconds": "number",
    },
}


def _round(v: float | None) -> float | None:
    return round(float(v), 6) if v is not None else None


def cluster_stats_by_id(
    data: ExperimentData,
    clusters: ClusterComputation,
    inds: dict[str, dict[str, float | None]] | None = None,
) -> dict[int, dict[str, float | None]]:
    """group_stats() per cluster over full-experiment members."""
    inds = inds if inds is not None else indicators_by_run(data)
    return {
        cid: metrics_mod.group_stats([inds[rid] for rid in member_ids])
        for cid, member_ids in clusters.members.items()
    }


def build_run_rows(
    data: ExperimentData, clusters: ClusterComputation
) -> list[dict]:
    inds = indicators_by_run(data)
    stats_by_cluster = cluster_stats_by_id(data, clusters, inds)
    rows: list[dict] = []
    for r in sorted(data.runs, key=lambda r: r.id):
        ind = inds[r.id]
        a = clusters.assignment_by_run.get(r.id)
        cluster_id = a.cluster_id if a else 0
        z = metrics_mod.run_vs_cluster_z(ind, stats_by_cluster.get(cluster_id, {}))
        rows.append(
            {
                "run_id": r.id,
                "task_id": r.task_id,
                "model": r.model,
                "outcome": r.outcome,
                "outcome_source": normalize_outcome_source(r.outcome_source),
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
                "cost_usd_z": _round(z.get("cost_usd_z")),
                "tokens_total_z": _round(z.get("tokens_total_z")),
                "latency_s_z": _round(z.get("latency_s_z")),
                "event_count_z": _round(z.get("event_count_z")),
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
    data: ExperimentData,
    clusters: ClusterComputation,
    scope_ids: set[str] | None = None,
) -> list[dict]:
    """One row per cluster. With `scope_ids`, stats re-aggregate over
    `members ∩ scope` — assignments and representatives stay experiment-
    global so cluster identity is stable under scoping; zero-member
    clusters render with n_runs=0 and null measurement stats."""
    inds = indicators_by_run(data)
    rows: list[dict] = []
    for cid in sorted(clusters.members):
        member_ids = clusters.members[cid]
        if scope_ids is not None:
            member_ids = [rid for rid in member_ids if rid in scope_ids]
        stats = metrics_mod.group_stats([inds[rid] for rid in member_ids])
        row: dict = {
            "cluster_id": cid,
            "n_runs": len(member_ids),
            "representative_run_id": clusters.representative_by_cluster.get(cid, ""),
            "outcome_label_source": outcome_label_source(data, set(member_ids)),
            "reported_pass_rate": _round(stats.get("reported_pass_rate")),
            "reported_error_rate": _round(stats.get("reported_error_rate")),
        }
        for field in _CLUSTER_STAT_FIELDS:
            for suffix in _CLUSTER_STAT_SUFFIXES:
                row[f"{field}_{suffix}"] = _round(stats.get(f"{field}_{suffix}"))
        rows.append(row)
    return rows


def build_edge_rows(data: ExperimentData) -> list[dict]:
    graph = rg_mod.build_aggregate_graph(
        data.events_by_run, outcomes_by_run=data.outcomes_by_run
    )
    target_by_id = {n.id: n.target for n in graph.nodes}
    rows = [
        {
            "source": target_by_id.get(e.source, e.source),
            "target": target_by_id.get(e.target, e.target),
            "count": e.count,
            "outcome_label_source": outcome_label_source(data),
            "reported_pass_count": e.reported_pass_count,
            "reported_fail_count": e.reported_fail_count,
            "reported_error_count": e.reported_error_count,
            "total_time_seconds": _round(e.total_time_seconds),
        }
        for e in graph.edges
    ]
    rows.sort(key=lambda r: (-r["count"], r["source"], r["target"]))
    return rows
