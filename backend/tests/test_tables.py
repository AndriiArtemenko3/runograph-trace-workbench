"""Row-builder + export-CLI tests against the sample-run fixture."""

from __future__ import annotations

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
    # The run passed, so every traversed edge carries pass_count >= 1.
    assert all(e["pass_count"] >= 1 for e in edges)


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
    assert row["pass_rate"] == 1.0
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
