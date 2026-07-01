"""Table API contract tests — JSON keys must equal the CSV column constants."""

from __future__ import annotations

import pytest

from tests.conftest import FIXTURE_RUN


@pytest.mark.asyncio
async def test_tables_api_serves_csv_shaped_rows(session):
    from httpx import ASGITransport, AsyncClient

    from runograph_backend.analysis import tables
    from runograph_backend.api.v1 import tables as tables_api
    from runograph_backend.main import app
    from runograph_backend.storage.ingest import ingest_run

    await ingest_run(session, FIXTURE_RUN)

    async def _session_override():
        yield session

    # Keyed on the exact session_scope object the router captured at import
    # time — the _isolate_db reload gives later imports a different object.
    app.dependency_overrides[tables_api.session_scope] = _session_override
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            expected = {
                "runs": tables.RUNS_COLUMNS,
                "steps": tables.STEPS_COLUMNS,
                "clusters": tables.CLUSTERS_COLUMNS,
                "edges": tables.EDGES_COLUMNS,
            }
            for sheet, columns in expected.items():
                r = await client.get(
                    f"/api/v1/tables/{sheet}", params={"experiment": "fixture-test"}
                )
                assert r.status_code == 200, r.text
                rows = r.json()
                assert rows, f"{sheet}: no rows"
                assert list(rows[0].keys()) == list(columns)

            r = await client.get("/api/v1/experiments")
            assert r.status_code == 200
            assert {"experiment_id": "fixture-test", "run_count": 1} in r.json()

            r = await client.get(
                "/api/v1/tables/runs", params={"experiment": "nope"}
            )
            assert r.status_code == 404
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_scope_params_and_alias_equivalence(session, tmp_path):
    from httpx import ASGITransport, AsyncClient

    from runograph_backend.api.v1 import routes as routes_api
    from runograph_backend.api.v1 import tables as tables_api
    from runograph_backend.main import app
    from runograph_backend.storage.ingest import ingest_run
    from tests.conftest import ingest_run_variant

    await ingest_run(session, FIXTURE_RUN)                      # pass
    await ingest_run_variant(session, tmp_path, "vr-fail", "fail")
    await ingest_run_variant(session, tmp_path, "vr-pass", "pass")

    async def _session_override():
        yield session

    app.dependency_overrides[tables_api.session_scope] = _session_override
    app.dependency_overrides[routes_api.session_scope] = _session_override
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            exp = {"experiment": "fixture-test"}

            # s= narrows run rows
            r = await client.get("/api/v1/tables/runs", params={**exp, "s": "outcome:eq:pass"})
            rows = r.json()
            assert len(rows) == 2 and all(x["outcome"] == "pass" for x in rows)

            # steps narrow by scope
            r = await client.get("/api/v1/tables/steps", params={**exp, "s": "outcome:eq:fail"})
            assert {x["run_id"] for x in r.json()} == {"vr-fail"}

            # edges recompute: pass-scoped graph has no fail traversals and
            # per-edge counts <= unscoped counts
            unscoped = {(e["source"], e["target"]): e["count"] for e in
                        (await client.get("/api/v1/tables/edges", params=exp)).json()}
            r = await client.get("/api/v1/tables/edges", params={**exp, "s": "outcome:eq:pass"})
            scoped_edges = r.json()
            assert scoped_edges and all(e["fail_count"] == 0 for e in scoped_edges)
            assert all(e["count"] <= unscoped[(e["source"], e["target"])] for e in scoped_edges)

            # clusters: assignment invariance under scope + n_runs re-aggregation
            base = (await client.get("/api/v1/tables/clusters", params=exp)).json()
            r = await client.get("/api/v1/tables/clusters", params={**exp, "s": "outcome:eq:fail"})
            scoped_clusters = r.json()
            assert [c["cluster_id"] for c in scoped_clusters] == [c["cluster_id"] for c in base]
            assert sum(c["n_runs"] for c in scoped_clusters) == 1

            # route pseudo-column through the API
            r = await client.get("/api/v1/tables/runs", params={**exp, "s": "route.event_type:in:test_run"})
            assert len(r.json()) == 3  # every variant shares the sample route

            # malformed predicate -> 422
            for bad in ("outcome:zz:x", "nope:eq:1", "total_tokens:gte:abc"):
                r = await client.get("/api/v1/tables/runs", params={**exp, "s": bad})
                assert r.status_code == 422, bad

            # whitelist with no matches -> empty 200
            r = await client.get("/api/v1/tables/runs", params={**exp, "runs": "zzz"})
            assert r.status_code == 200 and r.json() == []

            # /routes/aggregate: legacy params are aliases for s= predicates
            a = await client.get("/api/v1/routes/aggregate", params={**exp, "outcome": "pass"})
            b = await client.get("/api/v1/routes/aggregate", params={**exp, "s": "outcome:eq:pass"})
            assert a.status_code == b.status_code == 200
            assert a.json() == b.json()
    finally:
        app.dependency_overrides.clear()
