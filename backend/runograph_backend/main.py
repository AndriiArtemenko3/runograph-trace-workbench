"""FastAPI entry point for the runograph-app backend.

Endpoints serve sim results to the React UI. During Phase A (weeks 1-3) the
endpoints return mock data; Phase B+ wires them to the real sim runner + DuckDB
aggregator.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__

app = FastAPI(
    title="runograph-backend",
    version=__version__,
    description="Sim engine + FastAPI surface for the desktop solver",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness probe used by the React dev server proxy."""
    return {"status": "ok", "version": __version__}


@app.get("/api/v1/harnesses")
async def list_harnesses() -> dict[str, list[dict[str, str]]]:
    """Stub — replaced with real DuckDB-aggregated data once sim runs land."""
    return {
        "harnesses": [
            {"id": "direct", "name": "Direct baseline", "ev": "+0.20"},
            {"id": "planner-edit", "name": "Planner + editor", "ev": "+0.52"},
            {"id": "localise-first", "name": "Localisation-first", "ev": "−0.01"},
            {"id": "validator-controlled", "name": "Validator-controlled", "ev": "−0.30"},
        ]
    }
