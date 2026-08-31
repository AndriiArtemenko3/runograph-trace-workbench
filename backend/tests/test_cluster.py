"""Regression coverage for behavior-only clustering."""

from __future__ import annotations

from dataclasses import fields
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np
import pytest

from runograph_backend.analysis import cluster as cluster_mod
from runograph_backend.analysis import tables
from runograph_backend.storage.models import Run
from runograph_backend.storage.schemas import CanonicalEvent, EventCost, EventType


def _event(
    event_id: str,
    offset_s: int,
    event_type: EventType,
    target: str,
) -> CanonicalEvent:
    return CanonicalEvent(
        event_id=event_id,
        timestamp=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(seconds=offset_s),
        type=event_type,
        target=target,
        cost=EventCost(tokens=10, time_seconds=0.1),
    )


def _experiment_data() -> tables.ExperimentData:
    runs: list[Run] = []
    events_by_run: dict[str, list[CanonicalEvent]] = {}
    started_at = datetime(2026, 1, 1, tzinfo=UTC)

    for index in range(8):
        run_id = f"run-{index}"
        short_route = index < 4
        runs.append(
            Run(
                id=run_id,
                task_id="task-1",
                model="test-model",
                started_at=started_at,
                ended_at=started_at + timedelta(seconds=10 if short_route else 60),
                outcome="running",
                total_tokens=100 if short_route else 2_000,
                total_cost_usd=0.01 if short_route else 0.5,
                experiment_id="experiment-1",
            )
        )
        specs: list[tuple[EventType, str]]
        if short_route:
            specs = [
                ("file_read", "src/a.py"),
                ("file_edit", "src/a.py"),
                ("test_run", "tests/test_a.py"),
            ]
        else:
            specs = [
                ("file_read", "src/a.py"),
                ("file_read", "src/b.py"),
                ("tool_call", "search"),
                ("test_run", "tests/test_a.py"),
                ("reflection", "plan"),
                ("error", "shell"),
            ]
        events_by_run[run_id] = [
            _event(f"{run_id}-{offset}", offset, event_type, target)
            for offset, (event_type, target) in enumerate(specs)
        ]

    return tables.ExperimentData(
        experiment_id="experiment-1",
        runs=runs,
        events_by_run=events_by_run,
    )


def _cluster_snapshot(clusters: tables.ClusterComputation) -> dict[str, object]:
    return {
        "k": clusters.k,
        "members": {
            cluster_id: tuple(sorted(run_ids)) for cluster_id, run_ids in clusters.members.items()
        },
        "assignments": {
            run_id: (assignment.cluster_id, assignment.distance_to_centroid)
            for run_id, assignment in clusters.assignment_by_run.items()
        },
        "representatives": dict(clusters.representative_by_cluster),
    }


def test_run_features_exclude_terminal_outcome_labels() -> None:
    assert tuple(field.name for field in fields(cluster_mod.RunFeatures)) == (
        "event_types",
        "unique_target_count",
        "event_tokens",
        "event_time_seconds",
    )


def test_identical_behavior_vectors_use_one_cluster_without_warning() -> None:
    feature = cluster_mod.RunFeatures(
        event_types=["file_read", "file_edit", "test_run"],
        unique_target_count=2,
        event_tokens=100,
        event_time_seconds=1.0,
    )
    result = cluster_mod.cluster_routes(
        {f"run-{index}": feature for index in range(4)},
        k_range=(2, 4),
    )

    assert result.k == 1
    assert {assignment.cluster_id for assignment in result.assignments} == {1}
    assert {assignment.distance_to_centroid for assignment in result.assignments} == {0.0}
    assert cluster_mod.FEATURE_NAMES == (
        "event_count",
        "unique_target_count",
        "error_count",
        "ratio_reads",
        "ratio_edits",
        "ratio_tool_calls",
        "log_event_tokens",
        "log_event_time_seconds",
    )


def test_run_permutations_preserve_matrices_assignments_and_tied_representatives() -> None:
    data = _experiment_data()
    run_ids = [run.id for run in data.runs]
    feature_by_run = {
        run.id: cluster_mod.RunFeatures(
            event_types=[event.type for event in data.events_by_run[run.id]],
            unique_target_count=len(
                {
                    event.target
                    for event in data.events_by_run[run.id]
                    if event.target
                }
            ),
            event_tokens=sum(event.cost.tokens for event in data.events_by_run[run.id]),
            event_time_seconds=sum(
                event.cost.time_seconds for event in data.events_by_run[run.id]
            ),
        )
        for run in data.runs
    }
    baseline_matrix, baseline_ids = cluster_mod._build_feature_matrix(feature_by_run)
    baseline = tables.compute_clusters(data, k_range=(2, 2))

    # Both clusters contain four identical vectors. Size ties therefore use
    # canonical member ids, while every member is an equidistant medoid tie.
    assert baseline.representative_by_cluster == {1: "run-0", 2: "run-4"}
    assert all(
        assignment.distance_to_centroid == 0.0
        for assignment in baseline.assignment_by_run.values()
    )

    permutations = [
        list(reversed(run_ids)),
        ["run-3", "run-6", "run-1", "run-5", "run-0", "run-7", "run-2", "run-4"],
    ]
    run_by_id = {run.id: run for run in data.runs}
    for order in permutations:
        permuted_features = {run_id: feature_by_run[run_id] for run_id in order}
        matrix, matrix_ids = cluster_mod._build_feature_matrix(permuted_features)
        assert matrix_ids == baseline_ids == sorted(run_ids)
        np.testing.assert_array_equal(matrix, baseline_matrix)

        permuted_data = tables.ExperimentData(
            experiment_id=data.experiment_id,
            runs=[run_by_id[run_id] for run_id in order],
            events_by_run={run_id: data.events_by_run[run_id] for run_id in order},
        )
        assert _cluster_snapshot(
            tables.compute_clusters(permuted_data, k_range=(2, 2))
        ) == _cluster_snapshot(baseline)


def test_equal_k_scores_use_documented_higher_k_tie_break(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from scipy.cluster import vq

    features = {
        f"run-{index}": cluster_mod.RunFeatures(
            event_types=["tool_call"] * (index + 1),
            unique_target_count=index + 1,
            event_tokens=(index + 1) * 10,
            event_time_seconds=float(index + 1),
        )
        for index in range(8)
    }

    def fixed_partitions(matrix, k, **_kwargs):
        labels = (
            np.asarray([0, 0, 0, 0, 1, 1, 1, 1])
            if k == 2
            else np.asarray([0, 0, 0, 0, 1, 1, 2, 2])
        )
        return np.zeros((k, matrix.shape[1])), labels

    monkeypatch.setattr(vq, "kmeans2", fixed_partitions)
    monkeypatch.setattr(cluster_mod, "_silhouette", lambda *_args: 1.0)

    result = cluster_mod.cluster_routes(features, k_range=(2, 3))

    assert result.k == 3


def test_external_metadata_changes_preserve_features_and_cluster_assignments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = _experiment_data()
    captured_matrices: list[tuple[np.ndarray, list[str]]] = []
    original_cluster_routes = cluster_mod.cluster_routes

    def recording_cluster_routes(
        features_by_run: dict[str, cluster_mod.RunFeatures],
        k_range: tuple[int, int] = (2, 12),
        **kwargs: Any,
    ) -> cluster_mod.ClusterResult:
        matrix, run_ids = cluster_mod._build_feature_matrix(features_by_run)
        captured_matrices.append((matrix.copy(), list(run_ids)))
        return original_cluster_routes(features_by_run, k_range=k_range, **kwargs)

    monkeypatch.setattr(cluster_mod, "cluster_routes", recording_cluster_routes)

    initial_clusters = tables.compute_clusters(data, k_range=(2, 2))
    initial_summary = tables.build_cluster_rows(data, initial_clusters)
    assert all(row["reported_pass_rate"] == 0.0 for row in initial_summary)
    assert all(row["reported_error_rate"] == 0.0 for row in initial_summary)

    run_by_id = {run.id: run for run in data.runs}
    for member_ids in initial_clusters.members.values():
        for index, run_id in enumerate(sorted(member_ids)):
            run_by_id[run_id].outcome = ("pass", "error", "fail")[min(index, 2)]
            run_by_id[run_id].total_tokens = 100_000 + index
            run_by_id[run_id].total_cost_usd = 1_000.0 + index

    relabelled_clusters = tables.compute_clusters(data, k_range=(2, 2))

    assert len(captured_matrices) == 2
    initial_matrix, initial_run_ids = captured_matrices[0]
    relabelled_matrix, relabelled_run_ids = captured_matrices[1]
    assert initial_matrix.shape == (len(data.runs), len(cluster_mod.FEATURE_NAMES))
    assert initial_run_ids == relabelled_run_ids
    np.testing.assert_array_equal(initial_matrix, relabelled_matrix)
    assert _cluster_snapshot(initial_clusters) == _cluster_snapshot(relabelled_clusters)

    rows_by_id = {
        row["cluster_id"]: row for row in tables.build_cluster_rows(data, relabelled_clusters)
    }
    for cluster_id, member_ids in relabelled_clusters.members.items():
        outcomes = [run_by_id[run_id].outcome for run_id in member_ids]
        assert rows_by_id[cluster_id]["reported_pass_rate"] == round(
            outcomes.count("pass") / len(outcomes), 6
        )
        assert rows_by_id[cluster_id]["reported_error_rate"] == round(
            outcomes.count("error") / len(outcomes), 6
        )
