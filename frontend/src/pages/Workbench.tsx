import { useEffect, useState } from "react";
import { clsx } from "clsx";

import type { AsyncState } from "../api/routes";
import {
  useExperiments,
  useTableRows,
} from "../api/tables";
import type { ClusterRow, EdgeRow, RunRow, StepRow } from "../api/tables";
import { DataTable, makeColumns } from "../components/DataTable";
import { TopBar } from "../components/TopBar";
import { useHashRoute } from "../router";
import type { SheetView } from "../router";

const SHEETS: SheetView[] = ["runs", "steps", "clusters", "edges"];

const RUN_COLUMNS = makeColumns<RunRow>([
  { key: "run_id" },
  { key: "outcome" },
  { key: "cluster_id", numeric: true },
  { key: "total_tokens", numeric: true },
  { key: "total_cost_usd", numeric: true },
  { key: "latency_s", numeric: true },
  { key: "event_count", numeric: true },
  { key: "tool_call_count", numeric: true },
  { key: "unique_targets", numeric: true },
  { key: "error_count", numeric: true },
  { key: "distance_to_centroid", numeric: true },
  { key: "is_representative" },
  { key: "model" },
  { key: "task_id" },
]);

const STEP_COLUMNS = makeColumns<StepRow>([
  { key: "run_id" },
  { key: "seq_idx", numeric: true },
  { key: "event_type" },
  { key: "target" },
  { key: "tokens", numeric: true },
  { key: "time_seconds", numeric: true },
]);

const CLUSTER_COLUMNS = makeColumns<ClusterRow>([
  { key: "cluster_id", numeric: true },
  { key: "n_runs", numeric: true },
  { key: "pass_rate", numeric: true },
  { key: "error_rate", numeric: true },
  { key: "representative_run_id" },
  { key: "cost_usd_mean", numeric: true },
  { key: "cost_usd_median", numeric: true },
  { key: "cost_usd_p95", numeric: true },
  { key: "cost_usd_std", numeric: true },
  { key: "tokens_total_mean", numeric: true },
  { key: "tokens_total_median", numeric: true },
  { key: "tokens_total_p95", numeric: true },
  { key: "tokens_total_std", numeric: true },
  { key: "latency_s_mean", numeric: true },
  { key: "latency_s_median", numeric: true },
  { key: "latency_s_p95", numeric: true },
  { key: "latency_s_std", numeric: true },
  { key: "event_count_mean", numeric: true },
  { key: "event_count_median", numeric: true },
  { key: "event_count_p95", numeric: true },
  { key: "event_count_std", numeric: true },
]);

const EDGE_COLUMNS = makeColumns<EdgeRow>([
  { key: "source" },
  { key: "target" },
  { key: "count", numeric: true },
  { key: "pass_count", numeric: true },
  { key: "fail_count", numeric: true },
  { key: "total_time_seconds", numeric: true },
]);

function SheetState<T>({
  state,
  children,
}: {
  state: AsyncState<T[]>;
  children: (rows: T[]) => JSX.Element;
}) {
  if (state.status === "loading") {
    return <p className="font-mono text-sm text-text-tertiary">loading…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="font-mono text-sm text-status-danger">{state.error}</p>
    );
  }
  return children(state.data);
}

function RunsSheet({ experimentId }: { experimentId: string }) {
  const state = useTableRows<RunRow>("runs", experimentId);
  const [groupByCluster, setGroupByCluster] = useState(false);
  return (
    <div>
      <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 font-mono text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={groupByCluster}
          onChange={(e) => setGroupByCluster(e.target.checked)}
        />
        group by cluster
      </label>
      <SheetState state={state}>
        {(rows) => (
          <DataTable
            data={rows}
            columns={RUN_COLUMNS}
            grouping={groupByCluster ? ["cluster_id"] : []}
          />
        )}
      </SheetState>
    </div>
  );
}

function StepsSheet({ experimentId }: { experimentId: string }) {
  const state = useTableRows<StepRow>("steps", experimentId);
  return (
    <SheetState state={state}>
      {(rows) => <DataTable data={rows} columns={STEP_COLUMNS} />}
    </SheetState>
  );
}

function ClustersSheet({ experimentId }: { experimentId: string }) {
  const state = useTableRows<ClusterRow>("clusters", experimentId);
  return (
    <SheetState state={state}>
      {(rows) => <DataTable data={rows} columns={CLUSTER_COLUMNS} />}
    </SheetState>
  );
}

function EdgesSheet({ experimentId }: { experimentId: string }) {
  const state = useTableRows<EdgeRow>("edges", experimentId);
  return (
    <SheetState state={state}>
      {(rows) => <DataTable data={rows} columns={EDGE_COLUMNS} />}
    </SheetState>
  );
}

export function Workbench() {
  const [view, navigate] = useHashRoute();
  const experiments = useExperiments();
  const [experimentId, setExperimentId] = useState<string | null>(null);

  useEffect(() => {
    if (experimentId === null && experiments.status === "ready") {
      const first = experiments.data[0];
      if (first) setExperimentId(first.experiment_id);
    }
  }, [experiments, experimentId]);

  return (
    <div className="min-h-screen bg-bg-canvas text-text-primary">
      <TopBar
        experiments={experiments.status === "ready" ? experiments.data : []}
        selected={experimentId}
        onSelect={setExperimentId}
      />
      <nav className="flex gap-1 border-b border-border-hairline bg-bg-panel px-6">
        {SHEETS.map((s) => (
          <button
            key={s}
            onClick={() => navigate(s)}
            className={clsx(
              "border-b-2 px-3 py-2 font-mono text-sm",
              s === view
                ? "border-accent-primary text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary",
            )}
          >
            {s}
          </button>
        ))}
      </nav>
      <main className="p-6">
        {experimentId === null ? (
          <p className="font-mono text-sm text-text-tertiary">
            loading experiments…
          </p>
        ) : view === "runs" ? (
          <RunsSheet experimentId={experimentId} />
        ) : view === "steps" ? (
          <StepsSheet experimentId={experimentId} />
        ) : view === "clusters" ? (
          <ClustersSheet experimentId={experimentId} />
        ) : (
          <EdgesSheet experimentId={experimentId} />
        )}
      </main>
    </div>
  );
}
