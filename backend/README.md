# RunoGraph backend

FastAPI read API and offline analysis engine over a local SQLite trace store.
The backend does not run agents, commands, tests, or graders.

## Setup and checks

```bash
uv sync --python 3.12.13 --extra dev --frozen
uv run --frozen ruff check .
uv run --frozen pytest -q
```

## Local workflows

```bash
# Seed synthetic demo data in .runograph-demo/runograph.sqlite
uv run --frozen python -m scripts.seed_demo

# Import a caller-produced run directory into a selected database
uv run --frozen python -m scripts.ingest_run /path/to/run \
  --db /path/to/runograph.sqlite

# Serve the selected database on loopback
RUNOGRAPH_DB_PATH=/path/to/runograph.sqlite \
  uv run --frozen uvicorn runograph_backend.main:app --reload

# Export UI-equivalent CSV tables
RUNOGRAPH_DB_PATH=/path/to/runograph.sqlite \
  uv run --frozen python -m scripts.export_runs \
  --experiment example --out /path/to/export
```

The seed command replaces the `demo-offline` experiment in the selected
database and leaves other experiment IDs untouched. It refuses to run if one
of its reserved `demo-a1`…`demo-b3` IDs belongs to another experiment. All six
bundles are prevalidated and replacement is one transaction; a mid-seed
failure leaves the previous demo intact.

The imported `outcome` field must carry `outcomeSource: external`. It is used
only as a caller-provided label for filtering and post-hoc summaries. Imported
token/cost fields are not recalculated or verified.

Current run, task, and experiment IDs use the safe public grammar
`[A-Za-z0-9][A-Za-z0-9._-]{0,127}`. Timestamps require offsets and are stored
with canonical UTC semantics; events must be chronological and inside the run
interval. Measurements are required, finite, and non-negative. A terminal run
requires `endedAt`; running latency may be `null` and is not treated as zero.
Same-identity re-import is atomic. A run-ID collision across experiment or
task is rejected before mutation.

On POSIX, managed/new database directories are `0700` and database/WAL/SHM
files are `0600`. Existing explicit `--db` parent directories keep their mode.
The default `.runograph-demo` directory is managed and is reset to `0700` on
every seed even when it already exists; passing `--db` opts out of that parent
directory mode change.
Default export directories are path-contained and private, with CSV/manifest
files at `0600`; unsafe legacy experiment IDs are sanitized and hash-suffixed.

Outcome provenance is persisted per run. Startup performs one narrow legacy
update: a database whose `run` table predates that column is marked `unknown`,
never guessed to be external. Re-import the original trace directories to
establish current `external` provenance; other old-schema compatibility is not
guaranteed.

## Read-only endpoints

- `GET /healthz`
- `GET /api/v1/experiments`
- `GET /api/v1/runs?experimentId=<id>`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/tables/{runs|steps|clusters|edges}?experiment=<id>`
- `GET /api/v1/routes/run/{run_id}`
- `GET /api/v1/routes/aggregate?experiment=<id>`
- `GET /api/v1/routes/clusters?experiment=<id>`

The development server has no authentication and is intended for loopback
use only. See the root
[architecture document](../docs/ARCHITECTURE.md) for the trust boundary.
