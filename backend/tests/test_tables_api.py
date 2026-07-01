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
