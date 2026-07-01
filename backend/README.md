# runograph-backend

FastAPI surface + analysis engine over the SQLite trace store.

```bash
uv sync --extra dev
uv run uvicorn runograph_backend.main:app --reload
```

Endpoints:

- `GET /healthz` — liveness
- `GET /api/v1/runs?experimentId=<id>` — run summaries
- `GET /api/v1/runs/{run_id}` — single run + events
- `POST /api/v1/runs/ingest` — ingest a run dir (`meta.json` + `events.jsonl`)
- `GET /api/v1/routes/run/{run_id}` — single-run route graph
- `GET /api/v1/routes/aggregate?experiment=<id>` — summed graph across runs (filterable)
- `GET /api/v1/routes/clusters?experiment=<id>` — path families via k-means

CLIs:

- `uv run python -m scripts.run_experiment --task <swe-bench-id> --model <id> --n <runs>` — run and ingest an experiment sweep
- `uv run python -m scripts.ingest_run <run_dir>` — ingest one run dir
