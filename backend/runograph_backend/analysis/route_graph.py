"""Derive a route-graph (nodes + edges) from a list of canonical events.

A "route" is the ordered sequence of `target` values an agent touched in
one run. The graph aggregates that sequence into:

  - nodes: one per unique target, with `kind` derived from event types,
    visit count, and average tokens / wall-clock per visit
  - edges: directed transitions `target[i] -> target[i+1]`, counted

Aggregate mode (across multiple runs) sums visit counts and edge counts.

Pure functions; no I/O. The API layer fetches events from SQLite, maps
them to schemas.CanonicalEvent, and passes lists into the functions here.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from itertools import pairwise

from runograph_backend.storage.schemas import CanonicalEvent

# Event-type -> high-level node kind. Files (read/edit) become "file" nodes;
# bash test runs become "action:test"; everything else becomes "action:tool".
_KIND_BY_EVENT_TYPE: dict[str, str] = {
    "file_read": "file",
    "file_edit": "file",
    "test_run": "action:test",
    "tool_call": "action:tool",
    "error": "action:error",
    "reflection": "action:reflection",
    "final": "action:final",
}


@dataclass
class GraphNode:
    id: str
    target: str
    kind: str
    visits: int = 0
    total_tokens: int = 0
    total_time_seconds: float = 0.0
    error_count: int = 0
    event_types: set[str] = field(default_factory=set)

    @property
    def avg_tokens(self) -> float:
        return self.total_tokens / self.visits if self.visits else 0.0

    @property
    def avg_time_seconds(self) -> float:
        return self.total_time_seconds / self.visits if self.visits else 0.0


@dataclass
class GraphEdge:
    source: str
    target: str
    count: int = 0
    total_time_seconds: float = 0.0
    # Post-hoc imported-label counts. Granularity is runs (not transitions):
    # each run that traversed this edge contributes once according to the
    # terminal outcome imported with that trace.
    reported_pass_count: int = 0
    reported_fail_count: int = 0
    reported_error_count: int = 0


@dataclass
class RouteGraph:
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    sequence_length: int  # total events that contributed (after target-None filter)
    run_count: int = 1


def _target_id(target: str) -> str:
    """Return the lossless graph identity for a target.

    A display slug cannot be an identity: punctuation replacement and
    truncation merge distinct targets (for example ``a/b`` and ``a_b``),
    which can also turn a real transition into a false self-edge.  Targets
    are already strings in the public graph contract, so retaining the full
    value is the only collision-free mapping.  Presentation layers may
    derive a shorter label without changing this id.
    """
    return target


def events_to_route(events: list[CanonicalEvent]) -> list[CanonicalEvent]:
    """Order events by timestamp and drop those without a target.

    Targetless events (e.g. `finish` with target=None) participate in
    sequence-length accounting but cannot be graph nodes.
    """
    return sorted(
        (e for e in events if e.target),
        key=lambda e: e.timestamp,
    )


def build_run_graph(events: list[CanonicalEvent]) -> RouteGraph:
    """Build a single-run route graph."""
    route = events_to_route(events)

    nodes_by_id: dict[str, GraphNode] = {}
    for evt in route:
        node_id = _target_id(evt.target or "")
        if node_id not in nodes_by_id:
            nodes_by_id[node_id] = GraphNode(
                id=node_id,
                target=evt.target or "",
                kind=_KIND_BY_EVENT_TYPE.get(evt.type, "action:tool"),
            )
        n = nodes_by_id[node_id]
        n.visits += 1
        n.total_tokens += evt.cost.tokens
        n.total_time_seconds += evt.cost.time_seconds
        n.event_types.add(evt.type)
        if evt.type == "error":
            n.error_count += 1

    edge_counter: Counter[tuple[str, str]] = Counter()
    edge_time: dict[tuple[str, str], float] = defaultdict(float)
    for prev, curr in pairwise(route):
        if not prev.target or not curr.target:
            continue
        key = (_target_id(prev.target), _target_id(curr.target))
        edge_counter[key] += 1
        edge_time[key] += curr.cost.time_seconds

    edges = [
        GraphEdge(source=src, target=dst, count=cnt, total_time_seconds=edge_time[(src, dst)])
        for (src, dst), cnt in sorted(edge_counter.items())
    ]

    return RouteGraph(
        nodes=[nodes_by_id[node_id] for node_id in sorted(nodes_by_id)],
        edges=edges,
        sequence_length=len(route),
        run_count=1,
    )


def build_aggregate_graph(
    events_by_run: dict[str, list[CanonicalEvent]],
    outcomes_by_run: dict[str, str] | None = None,
) -> RouteGraph:
    """Sum node + edge counts across every run in the experiment.

    When ``outcomes_by_run`` is provided, also tallies post-hoc stored-label
    counts per edge (one increment per unique edge per run). The API/table
    layer carries their external/unknown/mixed provenance separately; the
    labels do not influence route construction.
    """
    nodes_by_id: dict[str, GraphNode] = {}
    edge_counter: Counter[tuple[str, str]] = Counter()
    edge_time: dict[tuple[str, str], float] = defaultdict(float)
    edge_pass_count: Counter[tuple[str, str]] = Counter()
    edge_fail_count: Counter[tuple[str, str]] = Counter()
    edge_error_count: Counter[tuple[str, str]] = Counter()
    total_sequence = 0

    for run_id, events in events_by_run.items():
        route = events_to_route(events)
        total_sequence += len(route)
        for evt in route:
            node_id = _target_id(evt.target or "")
            if node_id not in nodes_by_id:
                nodes_by_id[node_id] = GraphNode(
                    id=node_id,
                    target=evt.target or "",
                    kind=_KIND_BY_EVENT_TYPE.get(evt.type, "action:tool"),
                )
            n = nodes_by_id[node_id]
            n.visits += 1
            n.total_tokens += evt.cost.tokens
            n.total_time_seconds += evt.cost.time_seconds
            n.event_types.add(evt.type)
            if evt.type == "error":
                n.error_count += 1

        # Tally transitions for this run + remember the unique edge set so
        # we attribute outcome once per (run, edge), not once per transition.
        this_run_edges: set[tuple[str, str]] = set()
        for prev, curr in pairwise(route):
            if not prev.target or not curr.target:
                continue
            key = (_target_id(prev.target), _target_id(curr.target))
            edge_counter[key] += 1
            edge_time[key] += curr.cost.time_seconds
            this_run_edges.add(key)

        if outcomes_by_run is not None:
            outcome = outcomes_by_run.get(run_id)
            if outcome == "pass":
                for key in this_run_edges:
                    edge_pass_count[key] += 1
            elif outcome == "fail":
                for key in this_run_edges:
                    edge_fail_count[key] += 1
            elif outcome == "error":
                for key in this_run_edges:
                    edge_error_count[key] += 1

    edges = [
        GraphEdge(
            source=src,
            target=dst,
            count=cnt,
            total_time_seconds=edge_time[(src, dst)],
            reported_pass_count=edge_pass_count[(src, dst)],
            reported_fail_count=edge_fail_count[(src, dst)],
            reported_error_count=edge_error_count[(src, dst)],
        )
        for (src, dst), cnt in sorted(edge_counter.items())
    ]

    return RouteGraph(
        nodes=[nodes_by_id[node_id] for node_id in sorted(nodes_by_id)],
        edges=edges,
        sequence_length=total_sequence,
        run_count=len(events_by_run),
    )


def route_as_target_sequence(events: list[CanonicalEvent]) -> list[str]:
    """Compact representation of one run's route. Used by cluster.py."""
    return [e.target for e in events_to_route(events) if e.target]
