import { useMemo, useState } from "react";
import clsx from "clsx";
import { AppShell } from "./AppShell";
import { LeftPane, type LeftPaneSection } from "../components/composites/LeftPane";
import type { BottomBarEntry } from "../components/composites/BottomBar";
import { RouteGraph } from "../components/RouteGraph";
import { RouteMetrics } from "../components/RouteMetrics";
import {
  useRouteClusters,
  useRunRoute,
  type ClusterSummary,
  type ClustersResponse,
  type RouteRunResponse,
} from "../api/routes";

/**
 * Routes page — D3 force-directed cluster grid + drill-down.
 *
 * Three view modes:
 *   1. Overview      — N cluster mini-graphs in a responsive grid.
 *   2. Cluster focus — one expanded cluster graph + members + metrics.
 *   3. Run focus     — one run's graph + metrics + outcome.
 *
 * State is held inline (selectedClusterId + selectedRunId). LeftPane is
 * rebuilt on the fly from the clusters payload.
 */

const DEFAULT_EXPERIMENT = "runograph-50";

type ViewMode =
  | { kind: "overview" }
  | { kind: "cluster"; clusterId: number }
  | { kind: "run"; runId: string };

function buildLeftPaneSections(
  clusters: ClusterSummary[],
  selectedClusterId: number | null,
  selectedRunId: string | null,
): LeftPaneSection[] {
  const sections: LeftPaneSection[] = [
    {
      title: "Clusters",
      rows: clusters.map((c) => ({
        label: c.clusterId === 0 ? "No-route" : `Cluster ${c.clusterId}`,
        value: `${c.size}`,
        selected: c.clusterId === selectedClusterId,
      })),
    },
  ];

  const active = clusters.find((c) => c.clusterId === selectedClusterId);
  if (active) {
    sections.push({
      title: `Cluster ${active.clusterId === 0 ? "No-route" : active.clusterId} runs`,
      rows: active.memberRunIds.map((rid) => ({
        label: rid.replace(/^runograph-50-/, ""),
        value: rid === active.representativeRunId ? "rep" : "",
        selected: rid === selectedRunId,
      })),
    });
  }
  return sections;
}

function ClusterCard({
  cluster,
  onSelect,
}: {
  cluster: ClusterSummary;
  onSelect: () => void;
}) {
  const isEmpty = cluster.representativeGraph.nodes.length === 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        "rounded-md bg-bg-panel border border-border-hairline p-3",
        "flex flex-col gap-2 text-left",
        "hover:border-accent-primary transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-primary",
      )}
      data-cluster={cluster.clusterId}
    >
      <header className="flex items-baseline justify-between">
        <h3 className="font-sans text-sm font-medium text-text-primary">
          {cluster.clusterId === 0 ? "No-route" : `Cluster ${cluster.clusterId}`}
        </h3>
        <span className="font-mono text-xs text-text-tertiary tabular-nums">
          {cluster.size} {cluster.size === 1 ? "run" : "runs"}
        </span>
      </header>
      <div className="bg-bg-canvas rounded border border-border-subtle flex items-center justify-center min-h-[160px]">
        {isEmpty ? (
          <span className="text-text-tertiary text-xs font-mono">
            empty route
          </span>
        ) : (
          <RouteGraph
            nodes={cluster.representativeGraph.nodes}
            edges={cluster.representativeGraph.edges}
            width={260}
            height={160}
          />
        )}
      </div>
      <div className="flex items-center justify-between text-2xs font-mono text-text-tertiary">
        <span>
          rep {cluster.representativeRunId.replace(/^runograph-50-/, "")}
        </span>
        <span>
          {cluster.representativeGraph.sequenceLength} events · {" "}
          {cluster.representativeGraph.nodes.length} nodes
        </span>
      </div>
    </button>
  );
}

function ClusterFocus({
  cluster,
  onRunSelect,
}: {
  cluster: ClusterSummary;
  onRunSelect: (runId: string) => void;
}) {
  return (
    <article className="flex flex-col gap-3">
      <header>
        <h2 className="font-sans text-lg font-medium text-text-primary">
          {cluster.clusterId === 0
            ? "No-route family"
            : `Path family ${cluster.clusterId}`}
        </h2>
        <p className="text-text-secondary text-sm">
          {cluster.size} {cluster.size === 1 ? "run" : "runs"} · representative {" "}
          <span className="font-mono text-text-primary">
            {cluster.representativeRunId}
          </span>
        </p>
      </header>
      <div className="bg-bg-panel rounded-md border border-border-hairline p-3">
        {cluster.representativeGraph.nodes.length === 0 ? (
          <div className="flex items-center justify-center min-h-[480px] text-text-tertiary text-sm font-mono">
            (this family contains runs that produced no events)
          </div>
        ) : (
          <RouteGraph
            nodes={cluster.representativeGraph.nodes}
            edges={cluster.representativeGraph.edges}
            width={760}
            height={480}
            labels
            settleMs={2500}
          />
        )}
      </div>
      <section className="bg-bg-panel rounded-md border border-border-hairline p-3">
        <h3 className="text-text-secondary text-xs uppercase tracking-wide pb-2">
          Member runs
        </h3>
        <ul className="grid grid-cols-5 gap-1 m-0 p-0 list-none">
          {cluster.memberRunIds.map((rid) => (
            <li key={rid}>
              <button
                type="button"
                onClick={() => onRunSelect(rid)}
                className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-bg-elevated text-left"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-status-success shrink-0"
                />
                <span className="font-mono text-2xs text-text-secondary truncate">
                  {rid.replace(/^runograph-50-/, "")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function RunFocus({
  run,
  onBack,
}: {
  run: RouteRunResponse;
  onBack: () => void;
}) {
  return (
    <article className="flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-sans text-lg font-medium text-text-primary">
            Run {run.runId}
          </h2>
          <p className="text-text-secondary text-sm">
            {run.taskId} · {run.model} ·{" "}
            <span
              className={clsx(
                "font-mono",
                run.outcome === "pass"
                  ? "text-status-success"
                  : run.outcome === "fail"
                    ? "text-status-danger"
                    : "text-text-tertiary",
              )}
            >
              {run.outcome}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="text-text-secondary hover:text-text-primary text-xs font-mono"
        >
          ← back
        </button>
      </header>
      <div className="bg-bg-panel rounded-md border border-border-hairline p-3">
        {run.graph.nodes.length === 0 ? (
          <div className="flex items-center justify-center min-h-[480px] text-text-tertiary text-sm font-mono">
            (this run produced no events)
          </div>
        ) : (
          <RouteGraph
            nodes={run.graph.nodes}
            edges={run.graph.edges}
            width={760}
            height={480}
            labels
            settleMs={2500}
          />
        )}
      </div>
    </article>
  );
}

function buildBottomBarEntries(
  data: ClustersResponse | null,
): { left: BottomBarEntry[]; right: BottomBarEntry[] } {
  const totalRuns = data
    ? data.clusters.reduce((acc, c) => acc + c.size, 0)
    : 0;
  return {
    left: [
      {
        tone: "info",
        label: "experiment",
        detail: data ? data.experimentId : "—",
      },
      {
        tone: "info",
        label: "runs",
        detail: data ? `${totalRuns} total` : "—",
      },
      {
        tone: "success",
        label: data ? `k=${data.k}` : "—",
        detail: data ? `${data.clusters.length} path families` : "",
      },
    ],
    right: [
      { tone: "info", label: "agg. graph", detail: data ? `${data.aggregateGraph.nodes.length} nodes` : "—" },
      { tone: "success", label: "v0.3-alpha", detail: "routes" },
    ],
  };
}

export function Routes() {
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const clustersState = useRouteClusters(DEFAULT_EXPERIMENT);
  const runState = useRunRoute(selectedRunId);

  const view: ViewMode = useMemo(() => {
    if (selectedRunId) return { kind: "run", runId: selectedRunId };
    if (selectedClusterId != null)
      return { kind: "cluster", clusterId: selectedClusterId };
    return { kind: "overview" };
  }, [selectedClusterId, selectedRunId]);

  const clusters =
    clustersState.status === "ready" ? clustersState.data.clusters : [];
  const activeCluster = clusters.find((c) => c.clusterId === selectedClusterId);
  const sections = buildLeftPaneSections(clusters, selectedClusterId, selectedRunId);
  const bottomEntries = buildBottomBarEntries(
    clustersState.status === "ready" ? clustersState.data : null,
  );

  const handleRowClick = (sectionTitle: string, label: string) => {
    if (sectionTitle === "Clusters") {
      const cid =
        label === "No-route"
          ? 0
          : parseInt(label.replace(/^Cluster\s+/, ""), 10);
      setSelectedClusterId(cid);
      setSelectedRunId(null);
    } else {
      // Member runs section — label is the abbreviated run id
      setSelectedRunId(`runograph-50-${label}`);
    }
  };

  const rightPane = (() => {
    if (view.kind === "run" && runState.status === "ready") {
      return (
        <RouteMetrics
          title={`Run ${runState.data.runId.replace(/^runograph-50-/, "")}`}
          subtitle={`${runState.data.model} · ${runState.data.outcome}`}
          metrics={runState.data.metrics}
        />
      );
    }
    if (view.kind === "cluster" && activeCluster) {
      return (
        <RouteMetrics
          title={
            activeCluster.clusterId === 0
              ? "No-route family"
              : `Cluster ${activeCluster.clusterId}`
          }
          subtitle={`${activeCluster.size} runs · means across cluster`}
          metrics={activeCluster.metrics}
        />
      );
    }
    if (clustersState.status === "ready") {
      // Aggregate metrics: mean of cluster means (acknowledged rough)
      const all = clustersState.data.clusters;
      const sample = all[0]?.metrics ?? {};
      const avg: Record<string, number> = {};
      for (const k of Object.keys(sample)) {
        const vals = all.map((c) => c.metrics[k] ?? 0);
        avg[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      }
      return (
        <RouteMetrics
          title="Experiment overview"
          subtitle={`${DEFAULT_EXPERIMENT} · cross-cluster mean`}
          metrics={avg}
        />
      );
    }
    return null;
  })();

  return (
    <AppShell
      crumb="/ 05 Routes"
      pageTitle="RunoGraph Routes"
      weightProfile="balanced"
      bottomLeft={bottomEntries.left}
      bottomRight={bottomEntries.right}
    >
      <LeftPane sections={sections} onRowClick={handleRowClick} />
      <section
        className="flex-1 min-w-0 bg-bg-canvas flex flex-col overflow-auto"
        data-canon="routes-page"
      >
        <div className="px-4 pt-4 pb-3 flex items-baseline gap-3">
          <h2 className="font-sans text-lg font-medium text-text-primary">
            Route clusters
          </h2>
          {clustersState.status === "ready" ? (
            <span className="text-text-secondary text-sm font-mono">
              {clustersState.data.experimentId} · k={clustersState.data.k}
            </span>
          ) : null}
          {(selectedClusterId != null || selectedRunId != null) && (
            <button
              type="button"
              onClick={() => {
                setSelectedRunId(null);
                setSelectedClusterId(null);
              }}
              className="ml-auto text-xs font-mono text-text-secondary hover:text-text-primary"
            >
              ← overview
            </button>
          )}
        </div>
        <div className="px-4 pb-4 flex-1 min-w-0">
          {clustersState.status === "loading" ? (
            <div className="text-text-secondary text-sm font-mono">
              Loading clusters…
            </div>
          ) : clustersState.status === "error" ? (
            <div className="text-status-danger text-sm font-mono">
              {clustersState.error}
            </div>
          ) : view.kind === "overview" ? (
            <div className="grid grid-cols-3 gap-3">
              {clustersState.data.clusters.map((c) => (
                <ClusterCard
                  key={c.clusterId}
                  cluster={c}
                  onSelect={() => {
                    setSelectedClusterId(c.clusterId);
                    setSelectedRunId(null);
                  }}
                />
              ))}
            </div>
          ) : view.kind === "cluster" && activeCluster ? (
            <ClusterFocus
              cluster={activeCluster}
              onRunSelect={(rid) => setSelectedRunId(rid)}
            />
          ) : view.kind === "run" && runState.status === "ready" ? (
            <RunFocus
              run={runState.data}
              onBack={() => setSelectedRunId(null)}
            />
          ) : runState.status === "loading" ? (
            <div className="text-text-secondary text-sm font-mono">
              Loading run…
            </div>
          ) : runState.status === "error" ? (
            <div className="text-status-danger text-sm font-mono">
              {runState.error}
            </div>
          ) : null}
        </div>
      </section>
      <aside
        aria-label="Metrics"
        className="w-[320px] shrink-0 bg-bg-panel border-l border-border-hairline flex flex-col gap-3 p-4 overflow-y-auto"
      >
        {rightPane}
      </aside>
    </AppShell>
  );
}
