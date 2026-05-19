import { useEffect, useState } from "react";
import { api } from "./client";
import type { SolverGridResponse } from "./types";

export type SolverGridState =
  | { status: "loading" }
  | { status: "ready"; data: SolverGridResponse }
  | { status: "error"; error: string };

/**
 * Fetches the solver-grid payload once per mount. Aborts on unmount so a
 * stale response can't flip a now-dead component into "ready".
 *
 * Phase-A uses fetch + useState directly. When the page count grows past
 * ~3 we move this to TanStack Query (cache, retries, refetch) — but for
 * one-page-one-endpoint, this stays tiny.
 */
export function useSolverGrid(): SolverGridState {
  const [state, setState] = useState<SolverGridState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    api
      .getSolverGrid(controller.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: "error", error: message });
      });
    return () => controller.abort();
  }, []);

  return state;
}
