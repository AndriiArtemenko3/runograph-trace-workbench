"""First-cut route metrics. Expect tuning after the first 50-run dataset.

Definitions (kept as module constants and pure functions so iteration is
cheap):

  efficiency      = 1 if passed else 0, normalised by event count
  drift           = unique_targets / total_events (scatter)
  loopiness       = repeated_edges / total_edges (revisit pressure)
  recovery        = events_after_first_error / total_events
                    (1.0 if no errors; the agent's resilience score)
  tool_discipline = 1 - (bash_events / total_events) (anti-shell-leaning)

These are first-draft. The right ones surface after looking at 50 real
runs side by side; this file is intentionally easy to edit.
"""

from __future__ import annotations

from collections import Counter

from runograph_backend.analysis.route_graph import (
    GraphEdge,
    events_to_route,
    route_as_target_sequence,
)
from runograph_backend.storage.schemas import CanonicalEvent


def efficiency(events: list[CanonicalEvent], passed: bool) -> float:
    n = len(events_to_route(events))
    if n == 0:
        return 0.0
    return (1.0 if passed else 0.0) / n


def drift(events: list[CanonicalEvent]) -> float:
    sequence = route_as_target_sequence(events)
    if not sequence:
        return 0.0
    return len(set(sequence)) / len(sequence)


def loopiness(edges: list[GraphEdge]) -> float:
    total = sum(e.count for e in edges)
    if total == 0:
        return 0.0
    repeats = sum(e.count - 1 for e in edges if e.count > 1)
    return repeats / total


def recovery(events: list[CanonicalEvent]) -> float:
    route = events_to_route(events)
    if not route:
        return 1.0
    first_error_idx: int | None = None
    for i, e in enumerate(route):
        if e.type == "error":
            first_error_idx = i
            break
    if first_error_idx is None:
        return 1.0
    after = len(route) - first_error_idx - 1
    return after / len(route)


def tool_discipline(events: list[CanonicalEvent]) -> float:
    """1.0 when the agent never used bash; 0.0 when every event was bash.

    This is a placeholder — refine once we see real route shapes. The
    intent is to flag agents that lean on shell instead of structured
    tools.
    """
    route = events_to_route(events)
    if not route:
        return 1.0
    bash_count = sum(
        1
        for e in route
        if e.target and (e.target.startswith("bash") or e.type == "tool_call" and "bash" in (e.content_summary or "").lower())
    )
    return 1.0 - bash_count / len(route)


def compute_all(
    events: list[CanonicalEvent],
    edges: list[GraphEdge],
    passed: bool,
) -> dict[str, float]:
    """Run every metric. Returns a flat dict keyed by metric name."""
    return {
        "efficiency": efficiency(events, passed),
        "drift": drift(events),
        "loopiness": loopiness(edges),
        "recovery": recovery(events),
        "tool_discipline": tool_discipline(events),
        "event_count": float(len(events_to_route(events))),
        "unique_targets": float(len({e.target for e in events_to_route(events) if e.target})),
        "error_count": float(sum(1 for e in events if e.type == "error")),
    }


def aggregate_metrics(per_run_metrics: list[dict[str, float]]) -> dict[str, float]:
    """Cluster-level rollup: mean of each metric across the cluster's runs."""
    if not per_run_metrics:
        return {}
    keys = per_run_metrics[0].keys()
    out: dict[str, float] = {}
    for k in keys:
        values = [m.get(k, 0.0) for m in per_run_metrics]
        out[k] = sum(values) / len(values) if values else 0.0
    return out
