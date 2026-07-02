import { useFetched } from "./routes";
import type { AsyncState } from "./routes";
import type { SheetView } from "../router";

/** Row shapes mirror the snake_case column constants in
 *  backend/runograph_backend/analysis/tables.py — same keys as the CSV
 *  export, by construction. */

export interface RunRow {
  run_id: string;
  task_id: string;
  model: string;
  outcome: string;
  total_tokens: number;
  total_cost_usd: number;
  latency_s: number;
  event_count: number;
  tool_call_count: number;
  unique_targets: number;
  error_count: number;
  cluster_id: number;
  distance_to_centroid: number;
  is_representative: boolean;
  cost_usd_z: number;
  tokens_total_z: number;
  latency_s_z: number;
  event_count_z: number;
}

export interface StepRow {
  run_id: string;
  seq_idx: number;
  event_type: string;
  target: string;
  tokens: number;
  time_seconds: number;
}

export interface ClusterRow {
  cluster_id: number;
  n_runs: number;
  representative_run_id: string;
  pass_rate: number;
  error_rate: number;
  cost_usd_mean: number;
  cost_usd_median: number;
  cost_usd_p95: number;
  cost_usd_std: number;
  tokens_total_mean: number;
  tokens_total_median: number;
  tokens_total_p95: number;
  tokens_total_std: number;
  latency_s_mean: number;
  latency_s_median: number;
  latency_s_p95: number;
  latency_s_std: number;
  event_count_mean: number;
  event_count_median: number;
  event_count_p95: number;
  event_count_std: number;
}

export interface EdgeRow {
  source: string;
  target: string;
  count: number;
  pass_count: number;
  fail_count: number;
  total_time_seconds: number;
}

export interface ExperimentInfo {
  experiment_id: string;
  run_count: number;
}

export function useExperiments(): AsyncState<ExperimentInfo[]> {
  return useFetched<ExperimentInfo[]>("/api/v1/experiments");
}

export interface ScopeParams {
  s: string[];
  runs: string | null;
}

export function useTableRows<T>(
  sheet: SheetView,
  experimentId: string | null,
  scope?: ScopeParams,
): AsyncState<T[]> {
  let url: string | null = null;
  if (experimentId) {
    const sp = new URLSearchParams({ experiment: experimentId });
    for (const pred of scope?.s ?? []) sp.append("s", pred);
    if (scope?.runs) sp.set("runs", scope.runs);
    url = `/api/v1/tables/${sheet}?${sp.toString()}`;
  }
  return useFetched<T[]>(url);
}
