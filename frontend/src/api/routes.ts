import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getJSON } from "./client";

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
  /** Post-hoc counts of stored outcome-labelled runs that traversed this edge.
   *  All are 0 for a single-run graph because only aggregate graphs attach
   *  imported outcome labels. Graph provenance says whether their source is
   *  external, unknown, mixed, or absent. They are not verification. */
  reportedPassCount?: number;
  reportedFailCount?: number;
  reportedErrorCount?: number;
}

export type StoredOutcomeSource = "external" | "unknown";
export type OutcomeLabelSource = StoredOutcomeSource | "mixed" | "none";

export interface RouteGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  sequenceLength: number;
  runCount: number;
  outcomeLabelSource: OutcomeLabelSource;
}

export interface ClusterSummary {
  clusterId: number;
  size: number;
  representativeRunId: string;
  memberRunIds: string[];
  outcomeLabelSource: OutcomeLabelSource;
  representativeGraph: RouteGraphData;
  metrics: Record<string, number | null>;
}

export interface ClustersResponse {
  experimentId: string;
  outcomeLabelSource: OutcomeLabelSource;
  k: number;
  clusters: ClusterSummary[];
  aggregateGraph: RouteGraphData;
  experimentStats: Record<string, number | null>;
}

export type ReportedOutcome = "running" | "pass" | "fail" | "error";

export interface RouteRunResponse {
  runId: string;
  taskId: string;
  model: string;
  outcome: ReportedOutcome;
  outcomeSource: StoredOutcomeSource;
  graph: RouteGraphData;
  metrics: Record<string, number | null>;
}

/** One row from /api/v1/runs?experimentId=... — header summary, no graph. */
export interface RunSummary {
  runId: string;
  taskId: string;
  model: string;
  outcome: ReportedOutcome;
  outcomeSource: StoredOutcomeSource;
  totalTokens: number;
  totalCostUsd: number;
  startedAt: string;
  endedAt: string | null;
  experimentId: string | null;
  eventCount: number;
}

export type AsyncDataState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

export type AsyncState<T> = AsyncDataState<T> & { retry: () => void };

export type JsonFetcher<T> = (url: string, signal: AbortSignal) => Promise<T>;

export interface RequestSnapshot<T> {
  url: string | null;
  state: AsyncDataState<T>;
}

export interface RequestRunner {
  run: () => Promise<void>;
  cancel: () => void;
}

/** Never expose data or errors produced for a previous request URL. */
export function stateForUrl<T>(
  snapshot: RequestSnapshot<T>,
  url: string | null,
): AsyncDataState<T> {
  return url !== null && snapshot.url === url
    ? snapshot.state
    : { status: "loading" };
}

/**
 * A small, framework-independent request runner. Starting a new attempt aborts
 * the previous one and publishes `loading` immediately; stale completions are
 * ignored. Keeping this outside React makes retry/recovery behaviour directly
 * testable while the hook below remains a thin lifecycle adapter.
 */
export function createRequestRunner<T>(
  url: string,
  publish: (state: AsyncDataState<T>) => void,
  fetcher: JsonFetcher<T> = (path, signal) => getJSON<T>(path, { signal }),
): RequestRunner {
  let active: AbortController | null = null;

  const run = async () => {
    active?.abort();
    const controller = new AbortController();
    active = controller;
    publish({ status: "loading" });

    try {
      const data = await fetcher(url, controller.signal);
      if (active !== controller || controller.signal.aborted) return;
      active = null;
      publish({ status: "ready", data });
    } catch (err: unknown) {
      if (active !== controller || controller.signal.aborted) return;
      active = null;
      const message = err instanceof Error ? err.message : String(err);
      publish({ status: "error", error: message });
    }
  };

  return {
    run,
    cancel: () => {
      const controller = active;
      active = null;
      controller?.abort();
    },
  };
}

export function useFetched<T>(url: string | null): AsyncState<T> {
  const [snapshot, setSnapshot] = useState<RequestSnapshot<T>>({
    url: null,
    state: { status: "loading" },
  });
  const runnerRef = useRef<RequestRunner | null>(null);

  useEffect(() => {
    if (!url) {
      runnerRef.current = null;
      return;
    }

    const runner = createRequestRunner<T>(url, (state) => {
      setSnapshot({ url, state });
    });
    runnerRef.current = runner;
    void runner.run();
    return () => {
      if (runnerRef.current === runner) runnerRef.current = null;
      runner.cancel();
    };
  }, [url]);

  const retry = useCallback(() => {
    void runnerRef.current?.run();
  }, []);

  const state = useMemo(() => stateForUrl(snapshot, url), [snapshot, url]);
  return useMemo(() => ({ ...state, retry }), [state, retry]);
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

/** Fetch the run summaries belonging to one experiment. */
export function useRunsList(experimentId: string): AsyncState<RunSummary[]> {
  return useFetched<RunSummary[]>(
    `/api/v1/runs?experimentId=${encodeURIComponent(experimentId)}`,
  );
}

/** Filters accepted by GET /api/v1/routes/aggregate. Any subset; absent
 *  keys mean "do not filter on this dimension". `runIds`, when present,
 *  is a hard whitelist applied before the other filters. */
export interface AggregateFilters {
  outcome?: "pass" | "fail" | "error";
  model?: string;
  costMin?: number;
  costMax?: number;
  latencyMin?: number;
  latencyMax?: number;
  runIds?: string[];
}

function aggregateUrl(
  experimentId: string,
  f: AggregateFilters | undefined,
): string {
  const params = new URLSearchParams({ experiment: experimentId });
  if (f) {
    if (f.outcome) params.set("outcome", f.outcome);
    if (f.model) params.set("model", f.model);
    if (f.costMin != null) params.set("costMin", String(f.costMin));
    if (f.costMax != null) params.set("costMax", String(f.costMax));
    if (f.latencyMin != null) params.set("latencyMin", String(f.latencyMin));
    if (f.latencyMax != null) params.set("latencyMax", String(f.latencyMax));
    if (f.runIds && f.runIds.length > 0) {
      params.set("runIds", f.runIds.join(","));
    }
  }
  return `/api/v1/routes/aggregate?${params.toString()}`;
}

/** Fetch the aggregate route graph. Null filters yields the full-experiment
 *  aggregate — identical to the `aggregateGraph` field on /clusters but
 *  cheaper because clustering is skipped server-side. */
export function useAggregateGraph(
  experimentId: string,
  filters?: AggregateFilters,
): AsyncState<RouteGraphData> {
  // useMemo-like memoization via JSON-stable key — re-render only when
  // filters actually change.
  return useFetched<RouteGraphData>(aggregateUrl(experimentId, filters));
}
