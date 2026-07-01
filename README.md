# runograph-app

B2B premium analysis workbench for AI coding agent harnesses. Data-first: aggregate many real agent runs, confirm patterns in tables, earn the visuals later.

React frontend (spreadsheet-style sheets over aggregated runs) paired with a FastAPI backend that ingests agent traces into SQLite and serves run/route/cluster aggregations.

The legacy MIT CLI is preserved on this repo's `legacy-cli` branch and is no longer developed.

## License

Proprietary commercial software — see `LICENSE`. Copyright (c) 2026 Andrii Artemenko, all rights reserved. Any use requires a written commercial agreement.

## Status

Pre-alpha. Building the v0.3 alpha for mid-June 2026 launch. See:
- `~/Desktop/MasterVaultV1/03-ideas-startups/strategy/2026-Q3.md` — quarterly strategy
- `~/Desktop/MasterVaultV1/03-ideas-startups/strategy/v1-demo-script.md` — what v0.3 must demo
- `~/Desktop/MasterVaultV1/03-ideas-startups/decisions/2026-05-19-runograph-sim-architecture.md` — sim engine spec
- `~/Desktop/MasterVaultV1/03-ideas-startups/decisions/2026-05-19-runograph-license-model.md` — original BUSL rationale (superseded 2026-07-01: proprietary commercial)

## Stack

- Frontend: React 18 + TypeScript + Vite + Tailwind CSS (+ @tanstack/react-table in phase 3)
- Backend: Python 3.12 + FastAPI + SQLAlchemy + SQLite (aiosqlite) + scipy/numpy (clustering)
- Tooling: pnpm workspaces, uv (Python)

## Development

```bash
# install
pnpm install
cd backend && uv sync --extra dev && cd ..

# run frontend
pnpm --filter frontend dev

# run backend
cd backend && uv run uvicorn runograph_backend.main:app --reload
```

## Repo structure

```
runograph-app/
├── frontend/          React + TypeScript + Vite
│   ├── src/api/        fetch client + typed hooks
│   ├── src/lib/        design-token bindings
│   └── src/styles/     token CSS variables
└── backend/           FastAPI + analysis engine
    └── runograph_backend/
        ├── storage/    SQLite models + trace ingestion
        ├── analysis/   route graphs, clustering, metrics
        ├── harness/    experiment runner (SWE-bench × Gemini)
        └── api/v1/     runs + routes endpoints
```
