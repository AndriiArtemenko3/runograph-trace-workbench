"""Export the four aggregation tables for one experiment as CSV.

Usage:
    uv run python -m scripts.export_runs --experiment runograph-50
    uv run python -m scripts.export_runs --experiment runograph-50 \
        --out /tmp/exports --db ~/.runograph/runs/runograph-50/runograph.sqlite

Writes runs.csv, route_steps.csv, clusters.csv, edges.csv to
~/.runograph/exports/<experiment>/ by default — never inside the repo.
Row shapes come from analysis.tables so the CSVs match the table API
column-for-column.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import os
from pathlib import Path


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--experiment", required=True, help="experiment id, e.g. runograph-50")
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output dir (default ~/.runograph/exports/<experiment>/)",
    )
    p.add_argument(
        "--db",
        type=Path,
        default=None,
        help="SQLite path override (sets RUNOGRAPH_DB_PATH)",
    )
    return p.parse_args()


def _write_csv(path: Path, columns: tuple[str, ...], rows: list[dict]) -> int:
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(columns))
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


async def export_experiment(session, experiment_id: str, out_dir: Path) -> dict[str, int]:
    """Build all four tables and write them as CSVs. Returns row counts."""
    from runograph_backend.analysis import tables

    data = await tables.load_experiment_data(session, experiment_id)
    if not data.runs:
        raise SystemExit(f"no runs found for experiment {experiment_id!r}")
    clusters = tables.compute_clusters(data)

    out_dir.mkdir(parents=True, exist_ok=True)
    counts = {
        "runs.csv": _write_csv(
            out_dir / "runs.csv", tables.RUNS_COLUMNS, tables.build_run_rows(data, clusters)
        ),
        "route_steps.csv": _write_csv(
            out_dir / "route_steps.csv", tables.STEPS_COLUMNS, tables.build_step_rows(data)
        ),
        "clusters.csv": _write_csv(
            out_dir / "clusters.csv",
            tables.CLUSTERS_COLUMNS,
            tables.build_cluster_rows(data, clusters),
        ),
        "edges.csv": _write_csv(
            out_dir / "edges.csv", tables.EDGES_COLUMNS, tables.build_edge_rows(data)
        ),
    }
    return counts


async def _main_async(experiment: str, out_dir: Path) -> None:
    # Imported here so a --db override (already in the env) wins over the
    # module-level engine default.
    from runograph_backend.storage.db import AsyncSessionLocal, init_db

    await init_db()
    async with AsyncSessionLocal() as session:
        counts = await export_experiment(session, experiment, out_dir)
    for name, n in counts.items():
        print(f"{out_dir / name}  ({n} rows)")


def main() -> None:
    args = _parse_args()
    if args.db is not None:
        os.environ["RUNOGRAPH_DB_PATH"] = str(args.db.expanduser())
    out_dir = args.out or (Path.home() / ".runograph" / "exports" / args.experiment)
    asyncio.run(_main_async(args.experiment, out_dir))


if __name__ == "__main__":
    main()
