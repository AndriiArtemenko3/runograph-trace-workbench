import type { SolverGridResponse } from "./types";

/**
 * Tiny fetch wrapper. All paths go through `/api/...` and ride the Vite dev
 * proxy (vite.config.ts) → http://127.0.0.1:8000. Same-origin in production
 * once the FastAPI server bundles the SPA static assets.
 */
async function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${path}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  getSolverGrid: (signal?: AbortSignal) =>
    getJSON<SolverGridResponse>("/api/v1/solver-grid", { signal }),
};
