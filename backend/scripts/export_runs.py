"""Export the four aggregation tables for one experiment as CSV.

Usage:
    uv run python -m scripts.export_runs --experiment runograph-50
    uv run python -m scripts.export_runs --experiment runograph-50 \
        --filter outcome:in:fail,error --filter total_cost_usd:gte:0.1
    uv run python -m scripts.export_runs --experiment runograph-50 \
        --out /tmp/exports --db ~/.runograph/runs/runograph-50/runograph.sqlite

Writes runs.csv, route_steps.csv, clusters.csv, edges.csv plus manifest.json
to ~/.runograph/exports/<experiment>/ by default — never inside the repo.
Row shapes come from analysis.tables so the CSVs match the table API
column-for-column; `--filter` takes the same predicate strings as the API's
`s=` param (see analysis/run_filter.py), `--runs` the same id whitelist.
Scope semantics match the API: runs/steps narrow; edges recompute over the
subset; clusters keep experiment-global assignments and re-aggregate stats.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
from datetime import datetime, timezone
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
    p.add_argument(
        "--filter",
        action="append",
        default=[],
        dest="filters",
        metavar="COLUMN:OP:VALUES",
        help="run-scope predicate (repeatable); same grammar as the API s= param",
    )
    p.add_argument(
        "--runs",
        default=None,
        help="comma-separated run-id whitelist (intersected with --filter)",
    )
    return p.parse_args()


def _write_csv(path: Path, columns: tuple[str, ...], rows: list[dict]) -> int:
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(columns))
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


async def export_experiment(
    session,
    experiment_id: str,
    out_dir: Path,
    filters: list[str] | None = None,
    runs: str | None = None,
) -> dict[str, int]:
    """Build all four tables (optionally run-scoped) and write CSVs +
    manifest. Returns per-file row counts. Raises ValueError on a bad
    filter string."""
    from runograph_backend.analysis import run_filter
    from runograph_backend.analysis import tables

    data = await tables.load_experiment_data(session, experiment_id)
    if not data.runs:
        raise SystemExit(f"no runs found for experiment {experiment_id!r}")

    preds = run_filter.parse_filters(filters or [])
    run_filter.validate_predicates(preds, tables.COLUMN_KINDS["runs"])
    whitelist = run_filter.parse_run_whitelist(runs)

    clusters = tables.compute_clusters(data)
    run_rows = tables.build_run_rows(data, clusters)

    scoped: set[str] | None = None
    if preds or whitelist is not None:
        scoped = run_filter.scoped_run_ids(data, run_rows, preds, whitelist)

    def in_scope(rid: str) -> bool:
        return scoped is None or rid in scoped

    edge_data = run_filter.narrow(data, scoped) if scoped is not None else data

    out_dir.mkdir(parents=True, exist_ok=True)
    counts = {
        "runs.csv": _write_csv(
            out_dir / "runs.csv",
            tables.RUNS_COLUMNS,
            [r for r in run_rows if in_scope(r["run_id"])],
        ),
        "route_steps.csv": _write_csv(
            out_dir / "route_steps.csv",
            tables.STEPS_COLUMNS,
            [r for r in tables.build_step_rows(data) if in_scope(r["run_id"])],
        ),
        "clusters.csv": _write_csv(
            out_dir / "clusters.csv",
            tables.CLUSTERS_COLUMNS,
            tables.build_cluster_rows(data, clusters, scope_ids=scoped),
        ),
        "edges.csv": _write_csv(
            out_dir / "edges.csv", tables.EDGES_COLUMNS, tables.build_edge_rows(edge_data)
        ),
    }

    manifest = {
        "experiment": experiment_id,
        "filters": list(filters or []),
        "run_ids": sorted(whitelist) if whitelist is not None else None,
        "matched_run_count": len(scoped) if scoped is not None else len(data.runs),
        "seed": 42,
        "exported_at": datetime.now(timezone.utc).isoformat(),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return counts


async def _main_async(
    experiment: str, out_dir: Path, filters: list[str], runs: str | None
) -> None:
    # Imported here so a --db override (already in the env) wins over the
    # module-level engine default.
    from runograph_backend.storage.db import AsyncSessionLocal, init_db

    await init_db()
    async with AsyncSessionLocal() as session:
        try:
            counts = await export_experiment(session, experiment, out_dir, filters, runs)
        except ValueError as exc:
            raise SystemExit(f"bad --filter/--runs: {exc}") from exc
    for name, n in counts.items():
        print(f"{out_dir / name}  ({n} rows)")


def main() -> None:
    args = _parse_args()
    if args.db is not None:
        os.environ["RUNOGRAPH_DB_PATH"] = str(args.db.expanduser())
    out_dir = args.out or (Path.home() / ".runograph" / "exports" / args.experiment)
    asyncio.run(_main_async(args.experiment, out_dir, args.filters, args.runs))


if __name__ == "__main__":
    main()
