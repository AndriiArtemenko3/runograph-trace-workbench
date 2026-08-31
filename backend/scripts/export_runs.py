"""Export the four aggregation tables for one experiment as CSV.

Usage:
    uv run python -m scripts.export_runs --experiment example
    uv run python -m scripts.export_runs --experiment example \
        --filter outcome:in:fail,error --filter total_cost_usd:gte:0.1
    uv run python -m scripts.export_runs --experiment example \
        --out /tmp/exports --db /path/to/runograph.sqlite

Writes runs.csv, route_steps.csv, clusters.csv, edges.csv plus manifest.json
to a sanitized, hash-suffixed directory below ~/.runograph/exports/ by default
— never inside the repo and never using a raw experiment ID as a path.
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
import hashlib
import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path

_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n")
_SAFE_DIR_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def _private_text_writer(path: Path, *, newline: str | None = None):
    """Open a sensitive output file with 0600 permissions even under umask 022."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    if os.name == "posix":
        os.fchmod(descriptor, 0o600)
    return os.fdopen(descriptor, "w", newline=newline)


def _prepare_private_output_dir(path: Path) -> None:
    managed_root = (Path.home() / ".runograph").resolve()
    resolved = path.resolve()
    if resolved.is_relative_to(managed_root):
        current = managed_root
        current.mkdir(mode=0o700, exist_ok=True)
        _chmod_private_directory(current)
        for component in resolved.relative_to(managed_root).parts:
            current /= component
            current.mkdir(mode=0o700, exist_ok=True)
            _chmod_private_directory(current)
        return
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    _chmod_private_directory(path)


def _chmod_private_directory(path: Path) -> None:
    if os.name == "posix":
        path.chmod(0o700)


def default_export_dir(experiment_id: str) -> Path:
    """Map any current or legacy experiment ID below the private export root."""
    prefix = _SAFE_DIR_CHARS.sub("-", experiment_id).strip(".-_")[:48] or "experiment"
    digest = hashlib.sha256(experiment_id.encode()).hexdigest()[:12]
    base = Path.home() / ".runograph" / "exports"
    destination = base / f"{prefix}-{digest}"
    if not destination.resolve().is_relative_to(base.resolve()):
        raise ValueError("derived export path escaped its private base directory")
    return destination


def _safe_csv_cell(value: object) -> object:
    """Prevent untrusted text from becoming a spreadsheet formula.

    CSV quoting does not stop Excel or Sheets from evaluating a cell that
    begins with a formula marker. Prefixing an apostrophe preserves the text
    interpretation used by spreadsheet applications. Numeric values remain
    numeric.
    """
    if not isinstance(value, str):
        return value
    candidate = value.lstrip(" \ufeff")
    return f"'{value}" if candidate.startswith(_FORMULA_PREFIXES) else value


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--experiment", required=True, help="experiment id, e.g. example")
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output dir (default: private encoded dir below ~/.runograph/exports)",
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
    with _private_text_writer(path, newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(columns))
        writer.writeheader()
        writer.writerows(
            {column: _safe_csv_cell(row.get(column)) for column in columns}
            for row in rows
        )
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
    from runograph_backend.analysis import run_filter, tables

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

    _prepare_private_output_dir(out_dir)
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
        "outcome_label_source": tables.outcome_label_source(edge_data),
        "filters": list(filters or []),
        "run_ids": sorted(whitelist) if whitelist is not None else None,
        "matched_run_count": len(scoped) if scoped is not None else len(data.runs),
        "seed": 42,
        "exported_at": datetime.now(UTC).isoformat(),
    }
    with _private_text_writer(out_dir / "manifest.json") as manifest_file:
        manifest_file.write(json.dumps(manifest, indent=2) + "\n")
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
    out_dir = args.out or default_export_dir(args.experiment)
    asyncio.run(_main_async(args.experiment, out_dir, args.filters, args.runs))


if __name__ == "__main__":
    main()
