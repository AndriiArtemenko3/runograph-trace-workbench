import { useEffect, useState } from "react";

/** Wire-format types from /api/v1/routes — camelCase aliases on the
 *  backend Pydantic models. */

export interface GraphNode {
  id: string;
  target: string;
  kind: string;
  visits: number;
  avgTokens: number;
  avgTimeSeconds: number;
  errorCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  count: number;
  totalTimeSeconds: number;
}

export interface RouteGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  sequenceLength: number;
  runCount: number;
}

export interface ClusterSummary {
  clusterId: number;
  size: number;
  representativeRunId: string;
  memberRunIds: string[];
  representativeGraph: RouteGraphData;
  metrics: Record<string, number>;
}

export interface ClustersResponse {
  experimentId: string;
  k: number;
  clusters: ClusterSummary[];
  aggregateGraph: RouteGraphData;
}

export interface RouteRunResponse {
  runId: string;
  taskId: string;
  model: string;
  outcome: string;
  graph: RouteGraphData;
  metrics: Record<string, number>;
}

/** One row from /api/v1/runs?experimentId=... — header summary, no graph. */
export interface RunSummary {
  runId: string;
  taskId: string;
  model: string;
  outcome: "pass" | "fail" | "error" | string;
  totalTokens: number;
  totalCostUsd: number;
  startedAt: string;
  endedAt: string;
  experimentId: string;
  eventCount: number;
}

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

function useFetched<T>(url: string | null): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  useEffect(() => {
    if (!url) return;
    setState({ status: "loading" });
    const ctrl = new AbortController();
    fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          throw new Error(`${r.status} ${r.statusText}: ${body.slice(0, 200)}`);
        }
        return (await r.json()) as T;
      })
      .then((data) => setState({ status: "ready", data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ status: "error", error: msg });
      });
    return () => ctrl.abort();
  }, [url]);
  return state;
}

export function useRouteClusters(
  experimentId: string,
): AsyncState<ClustersResponse> {
  return useFetched<ClustersResponse>(
    `/api/v1/routes/clusters?experiment=${encodeURIComponent(experimentId)}`,
  );
}

export function useRunRoute(runId: string | null): AsyncState<RouteRunResponse> {
  return useFetched<RouteRunResponse>(
    runId ? `/api/v1/routes/run/${encodeURIComponent(runId)}` : null,
  );
}

/** Per-experiment run list. Backend returns rows for adjacent experiments
 *  too, so callers should filter on experimentId. */
export function useRunsList(experimentId: string): AsyncState<RunSummary[]> {
  return useFetched<RunSummary[]>(
    `/api/v1/runs?experimentId=${encodeURIComponent(experimentId)}`,
  );
}
