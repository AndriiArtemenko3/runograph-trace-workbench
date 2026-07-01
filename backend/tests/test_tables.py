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
