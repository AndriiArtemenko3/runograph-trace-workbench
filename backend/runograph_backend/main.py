"""FastAPI entry point for the offline RunoGraph analysis backend.

Serves caller-provided trace metadata from SQLite to the React workbench.
Tables are created idempotently on lifespan startup so a fresh `uvicorn`
invocation works against an empty ~/.runograph/runograph.sqlite. Startup also
marks pre-provenance legacy outcome rows as ``unknown``; it does not provide a
general schema-migration framework.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .api.v1.routes import router as routes_router
from .api.v1.runs import router as runs_router
from .api.v1.tables import router as tables_router
from .storage.db import init_db


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    yield


app = FastAPI(
    title="runograph-backend",
    version=__version__,
    description="Read-only API over caller-provided offline trace data",
    lifespan=_lifespan,
)

# Vite may bind to 5173 or another port in its local development range. This
# narrowly permits loopback origins on 5170-5179; FastAPI does not serve the
# built SPA or define a production deployment topology.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):517[0-9]",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(runs_router)
app.include_router(routes_router)
app.include_router(tables_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness probe used by the React dev server proxy."""
    return {"status": "ok", "version": __version__}
