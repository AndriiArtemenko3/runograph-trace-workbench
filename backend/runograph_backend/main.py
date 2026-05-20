"""FastAPI entry point for the runograph-app backend.

Endpoints serve sim results to the React UI. During Phase A (weeks 1-3) the
endpoints return mock data; Phase B+ wires them to the real sim runner +
DuckDB aggregator.

Phase-B trace store: SQLite via storage.db. Tables are created idempotently
on lifespan startup so a fresh `uvicorn` invocation works against an empty
~/.runograph/runs/.../runograph.sqlite without an explicit migration step.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .api.v1.editor import router as editor_router
from .api.v1.heatmap import router as heatmap_router
from .api.v1.routes import router as routes_router
from .api.v1.runs import router as runs_router
from .api.v1.solver_grid import router as solver_grid_router
from .api.v1.stagetree import router as stagetree_router
from .storage.db import init_db


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    yield


app = FastAPI(
    title="runograph-backend",
    version=__version__,
    description="Sim engine + FastAPI surface for the desktop solver",
    lifespan=_lifespan,
)

# Vite dev server may bind to 5173 or auto-bump to the next free port if 5173
# is held by another project — accept any localhost dev origin in 5170-5179
# without re-listing every port. (Production builds are same-origin behind the
# bundled FastAPI server, so CORS is dev-only.)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):51[0-9]{2}",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(solver_grid_router)
app.include_router(heatmap_router)
app.include_router(stagetree_router)
app.include_router(editor_router)
app.include_router(runs_router)
app.include_router(routes_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness probe used by the React dev server proxy."""
    return {"status": "ok", "version": __version__}


@app.get("/api/v1/harnesses")
async def list_harnesses() -> dict[str, list[dict[str, str]]]:
    """Lightweight harness list — kept for the old smoke probe; deprecated in
    favour of GET /api/v1/solver-grid which carries the full grid payload.
    """
    return {
        "harnesses": [
            {"id": "A", "name": "single-sonnet", "ev": "+0.20"},
            {"id": "B", "name": "haiku-triage → sonnet-edit", "ev": "+0.52"},
            {"id": "C", "name": "haiku-only", "ev": "−0.11"},
            {"id": "D", "name": "sonnet + 3-retry repair", "ev": "+0.34"},
        ]
    }
