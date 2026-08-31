"""Regression coverage for lossless route identities."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from itertools import pairwise

from runograph_backend.analysis import route_graph, tables
from runograph_backend.storage.models import Run
from runograph_backend.storage.schemas import CanonicalEvent, EventCost


def _events(run_id: str, targets: list[str]) -> list[CanonicalEvent]:
    started_at = datetime(2026, 1, 1, tzinfo=UTC)
    return [
        CanonicalEvent(
            event_id=f"{run_id}-{index}",
            timestamp=started_at + timedelta(seconds=index),
            type="tool_call",
            target=target,
            cost=EventCost(tokens=10, time_seconds=0.25),
        )
        for index, target in enumerate(targets)
    ]


def _run(run_id: str, outcome: str) -> Run:
    started_at = datetime(2026, 1, 1, tzinfo=UTC)
    return Run(
        id=run_id,
        task_id="collision-regression",
        model="test-model",
        started_at=started_at,
        ended_at=started_at + timedelta(seconds=5),
        outcome=outcome,
        outcome_source="external",
        total_tokens=60,
        total_cost_usd=0.0,
        experiment_id="collision-regression",
    )


def test_colliding_display_slugs_remain_distinct_in_run_graph() -> None:
    long_prefix = "nested/" + ("x" * 140)
    targets = [
        "a/b",
        "a_b",
        "a:b",
        "a_b",
        f"{long_prefix}-one",
        f"{long_prefix}-two",
    ]

    graph = route_graph.build_run_graph(_events("run-a", targets))
    expected_edges = set(pairwise(targets))

    assert {node.id for node in graph.nodes} == set(targets)
    assert {node.target for node in graph.nodes} == set(targets)
    assert {(edge.source, edge.target) for edge in graph.edges} == expected_edges
    assert all(edge.source != edge.target for edge in graph.edges)


def test_collision_free_identity_reaches_aggregate_graph_and_edge_table() -> None:
    long_prefix = "nested/" + ("x" * 140)
    targets = [
        "a/b",
        "a_b",
        "a:b",
        "a_b",
        f"{long_prefix}-one",
        f"{long_prefix}-two",
    ]
    expected_edges = set(pairwise(targets))
    events_by_run = {
        "run-b": _events("run-b", targets),
        "run-a": _events("run-a", targets),
    }

    graph = route_graph.build_aggregate_graph(
        events_by_run,
        outcomes_by_run={"run-a": "pass", "run-b": "fail"},
    )
    assert {node.id for node in graph.nodes} == set(targets)
    assert {(edge.source, edge.target) for edge in graph.edges} == expected_edges
    assert all(edge.source != edge.target for edge in graph.edges)
    assert all(edge.count == 2 for edge in graph.edges)
    assert all(edge.reported_pass_count == 1 for edge in graph.edges)
    assert all(edge.reported_fail_count == 1 for edge in graph.edges)

    data = tables.ExperimentData(
        experiment_id="collision-regression",
        runs=[_run("run-b", "fail"), _run("run-a", "pass")],
        events_by_run=events_by_run,
    )
    rows = tables.build_edge_rows(data)

    assert {(row["source"], row["target"]) for row in rows} == expected_edges
    assert all(row["source"] != row["target"] for row in rows)
    assert all(row["count"] == 2 for row in rows)
