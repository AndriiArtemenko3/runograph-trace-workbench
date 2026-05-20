"""CLI wrapper around storage.ingest.ingest_run for offline replay.

Usage:
  uv run python -m runograph_backend.scripts.ingest_run <run_dir>

Or after installing the package:
  python -m runograph_backend.scripts.ingest_run ~/.runograph/runs/runograph-50/runs/<id>
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from runograph_backend.storage.db import AsyncSessionLocal, init_db
from runograph_backend.storage.ingest import ingest_run


async def _run(run_dir: Path) -> None:
    await init_db()
    async with AsyncSessionLocal() as session:
        run_id, n = await ingest_run(session, run_dir)
    print(f"ingested {run_id} ({n} events)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest one run dir into the trace store.")
    parser.add_argument("run_dir", type=Path, help="Path to <run_dir> containing meta.json + events.jsonl")
    args = parser.parse_args()
    run_dir = args.run_dir.expanduser().resolve()
    if not run_dir.is_dir():
        raise SystemExit(f"not a directory: {run_dir}")
    asyncio.run(_run(run_dir))


if __name__ == "__main__":
    main()
