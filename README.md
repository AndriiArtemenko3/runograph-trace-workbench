# runograph-app

B2B premium analysis workbench for AI coding agent harnesses. The visual layer of the RunoGraph stack.

This is the React + Tauri frontend (Phase A: web; Phase B: Tauri wrap) paired with the FastAPI backend that serves Monte Carlo sim results to the UI.

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

- Frontend: React 18 + TypeScript + Vite + Tailwind CSS + Zustand + xyflow + D3
- Backend: Python 3.12 + FastAPI + asyncio + SQLAlchemy + DuckDB + vLLM (inference)
- Tooling: pnpm workspaces, uv (Python), Storybook 8

## Development

```bash
# install
pnpm install
cd backend && uv sync && cd ..

# run frontend (Vite dev + Storybook in parallel)
pnpm --filter frontend dev
pnpm --filter frontend storybook

# run backend
cd backend && uv run uvicorn runograph_backend.main:app --reload
```

## Repo structure

```
runograph-app/
├── frontend/          React + TypeScript + Vite
│   ├── src/components/ Canon Figma components ported (Heat-tile, EV-cell, etc.)
│   ├── src/lib/        utilities, token bindings, design-system primitives
│   └── .storybook/     visual reference + verification against Figma
└── backend/           FastAPI + sim engine
    └── runograph_backend/  task queue, worker pool, capture, aggregator
```
