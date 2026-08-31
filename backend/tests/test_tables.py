"""Row-builder + export-CLI tests against the sample-run fixture."""

from __future__ import annotations

import os
import stat
from datetime import UTC, datetime

import pytest

from tests.conftest import FIXTURE_RUN


async def _ingested_data(session):
    from runograph_backend.analysis import tables
    from runograph_backend.storage.ingest import ingest_run

    await ingest_run(session, FIXTURE_RUN)
    return await tables.load_experiment_data(session, "fixture-test")


@pytest.mark.asyncio
async def test_run_rows_from_fixture(session):
    from runograph_backend.analysis import tables

    data = await _ingested_data(session)
    clusters = tables.compute_clusters(data)
    rows = tables.build_run_rows(data, clusters)

    assert len(rows) == 1
    row = rows[0]
    assert list(row.keys()) == list(tables.RUNS_COLUMNS)
    assert row["run_id"] == "sample-run-0001"
    assert row["outcome"] == "pass"
    assert row["outcome_source"] == "external"
    assert row["total_tokens"] == 11842
    assert row["event_count"] == 10
    # A single run is below k_min, so cluster_routes short-circuits to one
    # cluster with the run as its own representative.
    assert row["cluster_id"] == 1
    assert row["is_representative"] is True


@pytest.mark.asyncio
async def test_step_and_edge_rows(session):
    from runograph_backend.analysis import tables

    data = await _ingested_data(session)

    steps = tables.build_step_rows(data)
    targeted = [e for e in data.events_by_run["sample-run-0001"] if e.target]
    assert len(steps) == len(targeted)
    assert [s["seq_idx"] for s in steps] == list(range(len(steps)))
    assert all(list(s.keys()) == list(tables.STEPS_COLUMNS) for s in steps)

    edges = tables.build_edge_rows(data)
    # One linear run: every transition lands on some edge, so edge counts
    # sum to steps - 1.
    assert sum(e["count"] for e in edges) == len(steps) - 1
    # The run carries an external pass label, so each traversed edge reports it.
    assert all(e["reported_pass_count"] >= 1 for e in edges)
    assert all(e["outcome_label_source"] == "external" for e in edges)


@pytest.mark.asyncio
async def test_edge_rows_keep_external_fail_and_error_labels_separate(
    session, tmp_path
):
    from runograph_backend.analysis import tables
    from tests.conftest import ingest_run_variant

    await _ingested_data(session)
    await ingest_run_variant(session, tmp_path, "reported-fail", "fail")
    await ingest_run_variant(session, tmp_path, "reported-error", "error")
    data = await tables.load_experiment_data(session, "fixture-test")

    edges = tables.build_edge_rows(data)
    assert edges
    assert all(
        edge["outcome_label_source"] == "external"
        and edge["reported_pass_count"] == 1
        and edge["reported_fail_count"] == 1
        and edge["reported_error_count"] == 1
        for edge in edges
    )


@pytest.mark.asyncio
async def test_cluster_rows_from_fixture(session):
    from runograph_backend.analysis import tables

    data = await _ingested_data(session)
    clusters = tables.compute_clusters(data)
    rows = tables.build_cluster_rows(data, clusters)

    assert len(rows) == 1
    row = rows[0]
    assert list(row.keys()) == list(tables.CLUSTERS_COLUMNS)
    assert row["n_runs"] == 1
    assert row["reported_pass_rate"] == 1.0
    assert row["outcome_label_source"] == "external"
    assert row["representative_run_id"] == "sample-run-0001"


@pytest.mark.asyncio
async def test_export_writes_four_csvs_with_exact_headers(session, tmp_path):
    from runograph_backend.analysis import tables
    from runograph_backend.storage.ingest import ingest_run
    from scripts.export_runs import export_experiment

    await ingest_run(session, FIXTURE_RUN)
    out = tmp_path / "exports"
    counts = await export_experiment(session, "fixture-test", out)

    expected_headers = {
        "runs.csv": tables.RUNS_COLUMNS,
        "route_steps.csv": tables.STEPS_COLUMNS,
        "clusters.csv": tables.CLUSTERS_COLUMNS,
        "edges.csv": tables.EDGES_COLUMNS,
    }
    assert set(counts) == set(expected_headers)
    for name, columns in expected_headers.items():
        lines = (out / name).read_text().splitlines()
        assert lines[0] == ",".join(columns)
        assert len(lines) - 1 == counts[name]


def test_export_neutralizes_spreadsheet_formula_prefixes(tmp_path):
    import csv

    from scripts.export_runs import _write_csv

    dangerous = ("=1+1", "+cmd", "-cmd", "@SUM(A1)", "\t=1", "\r=1", "  =1")
    path = tmp_path / "untrusted.csv"
    _write_csv(path, ("value", "count"), [{"value": value, "count": -1} for value in dangerous])

    with path.open(newline="") as csv_file:
        rows = list(csv.DictReader(csv_file))
    assert [row["value"] for row in rows] == [f"'{value}" for value in dangerous]
    assert {row["count"] for row in rows} == {"-1"}


@pytest.mark.asyncio
async def test_z_columns_zero_for_single_run(session):
    from runograph_backend.analysis import tables

    data = await _ingested_data(session)
    clusters = tables.compute_clusters(data)
    row = tables.build_run_rows(data, clusters)[0]
    # One run per cluster -> zero spread -> z is 0 by construction.
    for col in ("cost_usd_z", "tokens_total_z", "latency_s_z", "event_count_z"):
        assert row[col] == 0.0


@pytest.mark.asyncio
async def test_z_columns_match_metrics_module(session, tmp_path):
    from runograph_backend.analysis import metrics, tables
    from tests.conftest import ingest_run_variant

    await _ingested_data(session)
    await ingest_run_variant(session, tmp_path, "vr-fail", "fail")
    await ingest_run_variant(session, tmp_path, "vr-pass", "pass")
    data = await tables.load_experiment_data(session, "fixture-test")
    clusters = tables.compute_clusters(data)
    inds = tables.indicators_by_run(data)
    stats = tables.cluster_stats_by_id(data, clusters, inds)
    for row in tables.build_run_rows(data, clusters):
        expected = metrics.run_vs_cluster_z(
            inds[row["run_id"]], stats.get(row["cluster_id"], {})
        )
        for col in ("cost_usd_z", "tokens_total_z", "latency_s_z", "event_count_z"):
            assert row[col] == round(expected[col], 6)


@pytest.mark.asyncio
async def test_scoped_cluster_rows_keep_cluster_identity(session, tmp_path):
    from runograph_backend.analysis import tables
    from tests.conftest import ingest_run_variant

    await _ingested_data(session)
    await ingest_run_variant(session, tmp_path, "vr-fail", "fail")
    await ingest_run_variant(session, tmp_path, "vr-pass", "pass")
    data = await tables.load_experiment_data(session, "fixture-test")
    clusters = tables.compute_clusters(data)

    unscoped = tables.build_cluster_rows(data, clusters)
    scoped = tables.build_cluster_rows(data, clusters, scope_ids={"vr-fail"})

    # Cluster identity (ids + representatives) is scope-invariant; only the
    # aggregated stats narrow.
    assert [r["cluster_id"] for r in scoped] == [r["cluster_id"] for r in unscoped]
    assert [r["representative_run_id"] for r in scoped] == [
        r["representative_run_id"] for r in unscoped
    ]
    assert sum(r["n_runs"] for r in scoped) == 1


@pytest.mark.asyncio
async def test_filtered_export_parity_and_manifest(session, tmp_path):
    import json

    from runograph_backend.analysis import tables
    from scripts.export_runs import export_experiment
    from tests.conftest import ingest_run_variant

    await _ingested_data(session)
    await ingest_run_variant(session, tmp_path, "vr-fail", "fail")
    await ingest_run_variant(session, tmp_path, "vr-pass", "pass")

    out = tmp_path / "exports-filtered"
    counts = await export_experiment(
        session, "fixture-test", out, filters=["outcome:eq:fail"]
    )
    assert counts["runs.csv"] == 1
    assert counts["clusters.csv"] > 0  # clusters keep identity, n_runs narrows

    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["filters"] == ["outcome:eq:fail"]
    assert manifest["matched_run_count"] == 1
    assert manifest["seed"] == 42
    assert manifest["outcome_label_source"] == "external"

    # scoped edges carry no pass traversals (only the fail run remains)
    edge_lines = (out / "edges.csv").read_text().splitlines()
    pass_idx = tables.EDGES_COLUMNS.index("reported_pass_count")
    assert all(line.split(",")[pass_idx] == "0" for line in edge_lines[1:])


@pytest.mark.asyncio
async def test_persisted_outcome_provenance_flows_through_analytics(
    session, tmp_path
):
    import json

    from runograph_backend.analysis import tables
    from runograph_backend.storage.models import Run
    from scripts.export_runs import export_experiment
    from tests.conftest import ingest_run_variant

    await _ingested_data(session)
    await ingest_run_variant(session, tmp_path, "current-external", "fail")
    legacy = await session.get(Run, "sample-run-0001")
    assert legacy is not None
    legacy.outcome_source = "unknown"
    await session.commit()

    data = await tables.load_experiment_data(session, "fixture-test")
    assert tables.outcome_label_source(data) == "mixed"
    assert tables.outcome_label_source(data, {"sample-run-0001"}) == "unknown"
    assert tables.outcome_label_source(data, {"current-external"}) == "external"
    assert tables.outcome_label_source(data, set()) == "none"

    clusters = tables.compute_clusters(data)
    run_sources = {row["outcome_source"] for row in tables.build_run_rows(data, clusters)}
    assert run_sources == {"external", "unknown"}
    assert {row["outcome_label_source"] for row in tables.build_cluster_rows(data, clusters)} == {
        "mixed"
    }
    assert {row["outcome_label_source"] for row in tables.build_edge_rows(data)} == {
        "mixed"
    }

    out = tmp_path / "mixed-export"
    await export_experiment(session, "fixture-test", out)
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["outcome_label_source"] == "mixed"


@pytest.mark.asyncio
async def test_export_csv_determinism(session, tmp_path):
    from scripts.export_runs import export_experiment
    from tests.conftest import ingest_run_variant

    await _ingested_data(session)
    await ingest_run_variant(session, tmp_path, "vr-fail", "fail")

    out_a, out_b = tmp_path / "det-a", tmp_path / "det-b"
    await export_experiment(session, "fixture-test", out_a)
    await export_experiment(session, "fixture-test", out_b)
    for name in ("runs.csv", "route_steps.csv", "clusters.csv", "edges.csv"):
        assert (out_a / name).read_bytes() == (out_b / name).read_bytes(), name


def test_unknown_latency_remains_null_and_never_matches_zero_filter() -> None:
    from runograph_backend.analysis import metrics, run_filter, tables
    from runograph_backend.storage.models import Run

    running = Run(
        id="running-run",
        task_id="running-task",
        model="producer",
        started_at=datetime(2026, 1, 1, tzinfo=UTC),
        ended_at=None,
        outcome="running",
        outcome_source="external",
        total_tokens=0,
        total_cost_usd=0.0,
        experiment_id="running-experiment",
    )
    data = tables.ExperimentData(
        experiment_id="running-experiment",
        runs=[running],
        events_by_run={"running-run": []},
    )
    clusters = tables.compute_clusters(data)
    row = tables.build_run_rows(data, clusters)[0]
    assert row["latency_s"] is None
    assert row["latency_s_z"] is None
    predicate = run_filter.parse_filter("latency_s:eq:0")
    assert not run_filter.row_matches(row, [predicate], tables.COLUMN_KINDS["runs"])
    cluster_row = tables.build_cluster_rows(data, clusters)[0]
    assert cluster_row["latency_s_mean"] is None

    # A malformed legacy row also remains unknown instead of being converted
    # into a plausible observed zero. Current ingest rejects this chronology.
    malformed = metrics.run_indicators(
        outcome="running",
        total_tokens=0,
        total_cost_usd=0.0,
        started_at=datetime(2026, 1, 1, 0, 1, tzinfo=UTC),
        ended_at=datetime(2026, 1, 1, 0, 0, tzinfo=UTC),
        events=[],
    )
    assert malformed["latency_s"] is None


def test_default_export_path_contains_legacy_unsafe_experiment_ids(
    tmp_path, monkeypatch
) -> None:
    from scripts.export_runs import default_export_dir

    monkeypatch.setenv("HOME", str(tmp_path))
    base = (tmp_path / ".runograph" / "exports").resolve()
    destinations = [
        default_export_dir(value)
        for value in ("../../escape", "/absolute/path", "a/b", "a,b", "")
    ]
    assert all(path.resolve().parent == base for path in destinations)
    assert len({path.name for path in destinations}) == len(destinations)


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission contract")
@pytest.mark.asyncio
async def test_export_outputs_are_private_under_umask_022(session, tmp_path):
    from runograph_backend.storage.ingest import ingest_run
    from scripts.export_runs import export_experiment

    await ingest_run(session, FIXTURE_RUN)
    out = tmp_path / "private-export"
    previous_umask = os.umask(0o022)
    try:
        await export_experiment(session, "fixture-test", out)
    finally:
        os.umask(previous_umask)

    assert stat.S_IMODE(out.stat().st_mode) == 0o700
    for path in out.iterdir():
        assert stat.S_IMODE(path.stat().st_mode) == 0o600, path.name


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission contract")
@pytest.mark.asyncio
async def test_default_export_parent_chain_is_private(session, tmp_path, monkeypatch):
    from runograph_backend.storage.ingest import ingest_run
    from scripts.export_runs import default_export_dir, export_experiment

    monkeypatch.setenv("HOME", str(tmp_path))
    await ingest_run(session, FIXTURE_RUN)
    out = default_export_dir("fixture-test")
    previous_umask = os.umask(0o022)
    try:
        await export_experiment(session, "fixture-test", out)
    finally:
        os.umask(previous_umask)

    for directory in (tmp_path / ".runograph", tmp_path / ".runograph" / "exports", out):
        assert stat.S_IMODE(directory.stat().st_mode) == 0o700, directory
