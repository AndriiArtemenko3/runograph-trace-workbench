"""FastAPI entry point for the runograph-app backend.

Serves aggregated agent-run data from the SQLite trace store to the React
workbench. Tables are created idempotently on lifespan startup so a fresh
`uvicorn` invocation works against an empty
~/.runograph/runs/.../runograph.sqlite without an explicit migration step.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

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

app.include_router(runs_router)
app.include_router(routes_router)
app.include_router(tables_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness probe used by the React dev server proxy."""
    return {"status": "ok", "version": __version__}
