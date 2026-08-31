"""CLI wrapper around storage.ingest.ingest_run for offline replay.

Usage:
  uv run python -m scripts.ingest_run <run_dir>

Or after installing the package:
  python -m scripts.ingest_run /path/to/run
"""

from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path


async def _run(run_dir: Path) -> None:
    # Imported after a possible --db override so the module-level engine is
    # bound to the requested file.
    from runograph_backend.storage.db import AsyncSessionLocal, init_db
    from runograph_backend.storage.ingest import ingest_run

    await init_db()
    async with AsyncSessionLocal() as session:
        run_id, n = await ingest_run(session, run_dir)
    print(f"ingested {run_id} ({n} events)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest one run dir into the trace store.")
    parser.add_argument(
        "run_dir",
        type=Path,
        help="path containing meta.json and events.jsonl",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="SQLite path override (sets RUNOGRAPH_DB_PATH)",
    )
    args = parser.parse_args()
    if args.db is not None:
        os.environ["RUNOGRAPH_DB_PATH"] = str(args.db.expanduser().resolve())
    run_dir = args.run_dir.expanduser().resolve()
    if not run_dir.is_dir():
        raise SystemExit(f"not a directory: {run_dir}")
    asyncio.run(_run(run_dir))


if __name__ == "__main__":
    main()
