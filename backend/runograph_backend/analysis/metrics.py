"""Trace indicators and post-hoc imported-label summaries.

Design principle: surface imported measurements and trace-derived counts an
external observer can reproduce, not synthesised abstractions. Outcome,
token totals, cost, and timestamps are supplied by the caller. The previous
"efficiency / drift / loopiness / recovery / tool_discipline" set was
hand-rolled and not auditable. This module keeps raw units and conventional
distribution statistics instead.

Three levels of aggregation:

  1. run_indicators(run, events)
     Per-run scalars pulled straight from the Run row + event count.
     Auditable: every field has a clear unit and source column.

  2. group_stats(per_run_indicators)
     Distribution stats for a cluster or the whole experiment. For each
     scalar field: mean, median, p95, std. Also reported_pass_rate and
     reported_error_rate from stored labels at the group level. Provenance is
     carried separately by the API/table layer.

  3. run_vs_cluster_z(run_ind, cluster_stats)
     Standard-score deltas: how many sigma this run is from the cluster
     mean on cost / tokens / latency / events. Lets the UI show a run's
     position in the cluster distribution at a glance.
"""

from __future__ import annotations

import math
from datetime import datetime

from runograph_backend.storage.schemas import CanonicalEvent

# ----- helpers -----


def _percentile(sorted_values: list[float], pct: float) -> float:
    """Linear-interpolation percentile on a pre-sorted list."""
    if not sorted_values:
        return 0.0
    n = len(sorted_values)
    if n == 1:
        return sorted_values[0]
    idx = max(0.0, min(n - 1, (n - 1) * pct))
    lower = math.floor(idx)
    upper = math.ceil(idx)
    if lower == upper:
        return sorted_values[lower]
    frac = idx - lower
    return sorted_values[lower] * (1 - frac) + sorted_values[upper] * frac


def _stddev(values: list[float], mean: float) -> float:
    if len(values) < 2:
        return 0.0
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1))


def _duration_s(started: datetime | None, ended: datetime | None) -> float | None:
    if not started or not ended:
        return None
    delta = (ended - started).total_seconds()
    return float(delta) if delta >= 0 else None


# ----- per-run -----


def run_indicators(
    *,
    outcome: str,
    total_tokens: int,
    total_cost_usd: float,
    started_at: datetime | None,
    ended_at: datetime | None,
    events: list[CanonicalEvent],
) -> dict[str, float | None]:
    """Trace-derived counts plus imported run metadata.

    ``reported_pass`` and ``reported_error`` mirror stored labels for post-hoc
    summaries; they are not verification results. Provenance is emitted by
    the caller-facing API/table layer.
    """
    n_events = len(events)
    unique_targets = len({e.target for e in events if e.target})
    error_count = sum(1 for e in events if e.type == "error")
    tool_calls = sum(
        1 for e in events if e.type in ("tool_call", "test_run")
    )
    return {
        "cost_usd": float(total_cost_usd),
        "tokens_total": float(total_tokens),
        "latency_s": _duration_s(started_at, ended_at),
        "event_count": float(n_events),
        "tool_call_count": float(tool_calls),
        "unique_targets": float(unique_targets),
        "error_count": float(error_count),
        "reported_pass": 1.0 if outcome == "pass" else 0.0,
        "reported_error": 1.0 if outcome == "error" else 0.0,
    }


# ----- per-group (cluster / experiment) -----


GROUP_DISTRIBUTION_FIELDS = (
    "cost_usd",
    "tokens_total",
    "latency_s",
    "event_count",
    "tool_call_count",
    "unique_targets",
    "error_count",
)


def group_stats(
    per_run: list[dict[str, float | None]],
) -> dict[str, float | None]:
    """Compute distribution stats (mean, median, p95, std) for the group.

    Also surfaces n_runs and rates from stored labels. Callers must pair those
    values with the provenance emitted by the API/table layer.
    """
    if not per_run:
        return {}
    n = len(per_run)
    out: dict[str, float | None] = {"n_runs": float(n)}

    passed = sum(float(m.get("reported_pass") or 0.0) for m in per_run)
    errored = sum(float(m.get("reported_error") or 0.0) for m in per_run)
    out["reported_pass_rate"] = passed / n
    out["reported_error_rate"] = errored / n

    for field in GROUP_DISTRIBUTION_FIELDS:
        vals = sorted(
            float(value)
            for metrics in per_run
            if (value := metrics.get(field)) is not None
        )
        if not vals:
            for suffix in ("mean", "median", "p95", "std", "min", "max"):
                out[f"{field}_{suffix}"] = None
            continue
        mean = sum(vals) / len(vals)
        out[f"{field}_mean"] = mean
        out[f"{field}_median"] = _percentile(vals, 0.5)
        out[f"{field}_p95"] = _percentile(vals, 0.95)
        out[f"{field}_std"] = _stddev(vals, mean)
        out[f"{field}_min"] = vals[0]
        out[f"{field}_max"] = vals[-1]

    return out


# ----- per-run vs cluster -----


Z_SCORE_FIELDS = ("cost_usd", "tokens_total", "latency_s", "event_count")


def run_vs_cluster_z(
    run_ind: dict[str, float | None],
    cluster_stats: dict[str, float | None],
) -> dict[str, float | None]:
    """Z-score of this run on each headline scalar against the cluster
    distribution. Returns 0.0 when the cluster has insufficient spread."""
    out: dict[str, float | None] = {}
    for field in Z_SCORE_FIELDS:
        mean = cluster_stats.get(f"{field}_mean")
        std = cluster_stats.get(f"{field}_std")
        value = run_ind.get(field)
        if value is None or mean is None or std is None:
            out[f"{field}_z"] = None
        else:
            out[f"{field}_z"] = (value - mean) / std if std > 1e-9 else 0.0
    return out
