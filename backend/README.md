# runograph-backend

FastAPI + sim engine for the desktop solver app.

```bash
uv sync
uv run uvicorn runograph_backend.main:app --reload
```

Endpoints (stubs during Phase A; live during Phase A end / Phase B):

- `GET /healthz` — liveness
- `GET /api/v1/harnesses` — list configured harnesses + their composite EV
- `GET /api/v1/runs` — list completed sim runs (paginated)
- `GET /api/v1/runs/{run_id}/heat-map` — corpus heat-map for a single sim run
- `GET /api/v1/runs/{run_id}/stage-tree` — stage decomposition for a single sim run
- `GET /api/v1/runs/{run_id}/matrix` — EV matrix + failure-class breakdown + per-task outliers
