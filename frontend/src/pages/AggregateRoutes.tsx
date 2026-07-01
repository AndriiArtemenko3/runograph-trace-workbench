import { useMemo, useState } from "react";
import clsx from "clsx";
import { AppShell } from "./AppShell";
import { AggregateRouteGraph } from "../components/AggregateRouteGraph";
import { DistributionStrip } from "../components/DistributionStrip";
import { RouteMetrics } from "../components/RouteMetrics";
import {
  TreemapBackdrop,
  DirectoryLayoutGraph,
  IcicleBackdrop,
  ForceGraph,
  ConformanceGraph,
} from "../components/RepoBackdrop";
import {
  useRouteClusters,
  useRunsList,
  useAggregateGraph,
  useTouchedNodes,
  useRepoTree,
  type AggregateFilters,
  type ClusterSummary,
  type RunSummary,
} from "../api/routes";

type RepoView = "off" | "treemap" | "directory" | "icicle" | "force" | "conformance";
const REPO_VIEW_STORAGE_KEY = "runograph.routes.repoView";

function readStoredRepoView(): RepoView {
  if (typeof window === "undefined") return "off";
  const v = window.localStorage.getItem(REPO_VIEW_STORAGE_KEY);
  if (
    v === "treemap" ||
    v === "directory" ||
    v === "icicle" ||
    v === "force" ||
    v === "conformance"
  )
    return v;
  return "off";
}

/**
 * Aggregate Routes page — the new tab 1.
 *
 * One D3 force-directed canvas summarising every run in the experiment.
 * Filter chips and distribution-strip brushes narrow the visible subset
 * without leaving the page. Right pane carries the experiment-level
 * indicators (unchanged contract from the prior cluster-card layout).
 *
 * Replaces both the old Matrix tab (SolverGrid) and the old cluster-card
 * Routes page. Both prior pages are archived under pages/_archived/.
 */

const DEFAULT_EXPERIMENT = "runograph-50";

type OutcomeFilter = "pass" | "fail" | "error" | null;

interface BrushedRange {
  cost: [number, number] | null;
  latency: [number, number] | null;
  tokens: [number, number] | null;
  events: [number, number] | null;
}

const NO_BRUSH: BrushedRange = {
  cost: null,
  latency: null,
  tokens: null,
  events: null,
};

function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
function formatLatency(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "—";
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}m${r.toString().padStart(2, "0")}s`;
}
function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}
function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toString();
}

function runDurationSeconds(r: RunSummary): number {
  const ms = Date.parse(r.endedAt) - Date.parse(r.startedAt);
  return Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
}

function clusterIdForRun(
  runId: string,
  clusters: ClusterSummary[],
): number | null {
  for (const c of clusters) {
    if (c.memberRunIds.includes(runId)) return c.clusterId;
  }
  return null;
}

function inRange(v: number, range: [number, number] | null): boolean {
  if (range == null) return true;
  return v >= range[0] && v <= range[1];
}

export function AggregateRoutes() {
  const [outcome, setOutcome] = useState<OutcomeFilter>(null);
  const [selectedClusters, setSelectedClusters] = useState<Set<number>>(
    () => new Set(),
  );
  const [brush, setBrush] = useState<BrushedRange>(NO_BRUSH);
  const [repoView, setRepoViewState] = useState<RepoView>(readStoredRepoView);
  const setRepoView = (v: RepoView) => {
    setRepoViewState(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(REPO_VIEW_STORAGE_KEY, v);
    }
  };

  const clustersState = useRouteClusters(DEFAULT_EXPERIMENT);
  const runsListState = useRunsList(DEFAULT_EXPERIMENT);
  const touchedState = useTouchedNodes(DEFAULT_EXPERIMENT);
  // Fetch repo tree only when a backdrop mode that needs it is active.
  const repoTreeState = useRepoTree(DEFAULT_EXPERIMENT, repoView === "off");

  const clusters =
    clustersState.status === "ready" ? clustersState.data.clusters : [];
  const runs = useMemo(() => {
    if (runsListState.status !== "ready") return [] as RunSummary[];
    return runsListState.data.filter(
      (r) => r.experimentId === DEFAULT_EXPERIMENT,
    );
  }, [runsListState]);

  // Compute the filtered run subset client-side. Even with backend filter
  // support we pass the resulting runIds so the server-side aggregator
  // hits the same set the indicators panel says is selected.
  const filteredRunIds = useMemo<string[] | null>(() => {
    const anyFilterActive =
      outcome != null ||
      selectedClusters.size > 0 ||
      brush.cost != null ||
      brush.latency != null ||
      brush.tokens != null ||
      brush.events != null;
    if (!anyFilterActive) return null;
    const kept = runs.filter((r) => {
      if (outcome != null && r.outcome !== outcome) return false;
      if (selectedClusters.size > 0) {
        const cid = clusterIdForRun(r.runId, clusters);
        if (cid == null || !selectedClusters.has(cid)) return false;
      }
      if (!inRange(r.totalCostUsd ?? 0, brush.cost)) return false;
      if (!inRange(runDurationSeconds(r), brush.latency)) return false;
      if (!inRange(r.totalTokens ?? 0, brush.tokens)) return false;
      if (!inRange(r.eventCount ?? 0, brush.events)) return false;
      return true;
    });
    return kept.map((r) => r.runId);
  }, [outcome, selectedClusters, brush, runs, clusters]);

  const aggregateFilters: AggregateFilters | undefined =
    filteredRunIds != null ? { runIds: filteredRunIds } : undefined;
  const filteredGraphState = useAggregateGraph(
    DEFAULT_EXPERIMENT,
    aggregateFilters,
  );

  // Pick which graph to render. When no filters: use the aggregateGraph
  // baked into the /clusters response (already in hand, no extra fetch).
  // When filters: use the /aggregate response.
  const renderGraph = useMemo(() => {
    if (filteredRunIds == null) {
      return clustersState.status === "ready"
        ? clustersState.data.aggregateGraph
        : null;
    }
    if (filteredRunIds.length === 0) {
      return { nodes: [], edges: [], sequenceLength: 0, runCount: 0 };
    }
    return filteredGraphState.status === "ready"
      ? filteredGraphState.data
      : null;
  }, [filteredRunIds, clustersState, filteredGraphState]);

  // Touched-nodes-by-run: exact per-run node sets from /touched-nodes.
  // Falls back to the cluster-representative approximation while the
  // touched-nodes fetch is in flight, so the page still renders quickly
  // on first load — the colouring just refines once the exact data lands.
  const touchedNodesByRun = useMemo<Record<string, Set<string>>>(() => {
    if (touchedState.status === "ready") {
      const out: Record<string, Set<string>> = {};
      for (const [rid, ids] of Object.entries(touchedState.data.touched)) {
        out[rid] = new Set(ids);
      }
      return out;
    }
    // Approximation fallback during fetch.
    const out: Record<string, Set<string>> = {};
    for (const c of clusters) {
      const nodeIds = new Set(c.representativeGraph.nodes.map((n) => n.id));
      for (const rid of c.memberRunIds) out[rid] = nodeIds;
    }
    return out;
  }, [touchedState, clusters]);

  // Right-pane indicators always describe the FULL experiment. Brushing
  // is a graph-only filter; the static stats stay anchored.
  const experimentStats =
    clustersState.status === "ready" ? clustersState.data.experimentStats : {};

  const valuesCost = useMemo(() => runs.map((r) => r.totalCostUsd ?? 0), [runs]);
  const valuesLatency = useMemo(
    () => runs.map((r) => runDurationSeconds(r)),
    [runs],
  );
  const valuesTokens = useMemo(() => runs.map((r) => r.totalTokens ?? 0), [runs]);
  const valuesEvents = useMemo(() => runs.map((r) => r.eventCount ?? 0), [runs]);

  const clearAllFilters = () => {
    setOutcome(null);
    setSelectedClusters(new Set());
    setBrush(NO_BRUSH);
  };

  const toggleCluster = (cid: number) => {
    setSelectedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  };

  const filteredRunCount =
    filteredRunIds != null ? filteredRunIds.length : runs.length;
  const passCountInSubset =
    filteredRunIds != null
      ? runs.filter(
          (r) =>
            filteredRunIds.includes(r.runId) && r.outcome === "pass",
        ).length
      : runs.filter((r) => r.outcome === "pass").length;

  return (
    <AppShell
      crumb="/ 01 Routes"
      pageTitle="RunoGraph Routes"
      weightProfile="balanced"
      bottomLeft={[
        {
          tone: "info",
          label: "experiment",
          detail:
            clustersState.status === "ready"
              ? clustersState.data.experimentId
              : "—",
        },
        {
          tone: "info",
          label: "runs",
          detail: `${filteredRunCount}/${runs.length} selected`,
        },
        {
          tone: "success",
          label: "agg. graph",
          detail: renderGraph
            ? `${renderGraph.nodes.length} nodes · ${renderGraph.edges.length} edges`
            : "—",
        },
      ]}
      bottomRight={[
        {
          tone: "success",
          label: "pass rate",
          detail:
            filteredRunCount > 0
              ? `${passCountInSubset}/${filteredRunCount} (${Math.round(
                  (passCountInSubset / filteredRunCount) * 100,
                )}%)`
              : "—",
        },
        {
          tone: "warning",
          label: "spend",
          detail: `$${runs
            .filter((r) =>
              filteredRunIds ? filteredRunIds.includes(r.runId) : true,
            )
            .reduce((s, r) => s + (r.totalCostUsd ?? 0), 0)
            .toFixed(2)}`,
        },
      ]}
    >
      <section
        className="flex-1 min-w-0 bg-bg-canvas flex flex-col overflow-hidden"
        data-canon="aggregate-routes-page"
      >
        <div className="px-5 pt-4 pb-3 flex items-baseline gap-3">
          <h2 className="font-sans text-lg font-medium text-text-primary">
            Aggregate routes
          </h2>
          {clustersState.status === "ready" ? (
            <span className="text-text-secondary text-sm font-mono">
              {clustersState.data.experimentId} ·{" "}
              {clustersState.data.aggregateGraph.runCount} runs
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-3">
            <RepoViewSelector
              value={repoView}
              onChange={setRepoView}
              fileCount={
                repoTreeState.status === "ready"
                  ? repoTreeState.data.fileCount
                  : null
              }
              touchedCount={
                repoTreeState.status === "ready"
                  ? repoTreeState.data.touchedCount
                  : null
              }
            />
            {(outcome ||
              selectedClusters.size > 0 ||
              brush.cost ||
              brush.latency ||
              brush.tokens ||
              brush.events) && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="text-xs font-mono text-text-secondary hover:text-text-primary"
              >
                clear filters ×
              </button>
            )}
          </div>
        </div>

        <FilterChipRow
          outcome={outcome}
          onOutcome={setOutcome}
          clusters={clusters}
          selectedClusters={selectedClusters}
          onToggleCluster={toggleCluster}
        />

        <div className="px-5 flex-1 min-h-0 min-w-0 flex items-stretch">
          <GraphCanvas
            graphState={clustersState.status}
            graph={renderGraph}
            runs={runs.filter((r) =>
              filteredRunIds ? filteredRunIds.includes(r.runId) : true,
            )}
            touchedNodesByRun={touchedNodesByRun}
            filterPending={
              filteredRunIds != null && filteredGraphState.status === "loading"
            }
            emptyFilter={filteredRunIds != null && filteredRunIds.length === 0}
            selectedRunCount={
              filteredRunIds != null ? filteredRunIds.length : runs.length
            }
            repoView={repoView}
            repoTree={
              repoTreeState.status === "ready" ? repoTreeState.data.tree : null
            }
          />
        </div>

        <div className="px-5 pb-4 pt-3 flex flex-col gap-2 border-t border-border-hairline">
          <DistributionStrip
            label="Cost"
            values={valuesCost}
            median={experimentStats.cost_usd_median ?? 0}
            p95={experimentStats.cost_usd_p95 ?? 0}
            sigma={experimentStats.cost_usd_std ?? 0}
            format={formatCost}
            brushRange={brush.cost}
            onBrush={(range) => setBrush((b) => ({ ...b, cost: range }))}
          />
          <DistributionStrip
            label="Latency"
            values={valuesLatency}
            median={experimentStats.latency_s_median ?? 0}
            p95={experimentStats.latency_s_p95 ?? 0}
            sigma={experimentStats.latency_s_std ?? 0}
            format={formatLatency}
            brushRange={brush.latency}
            onBrush={(range) => setBrush((b) => ({ ...b, latency: range }))}
          />
          <DistributionStrip
            label="Tokens"
            values={valuesTokens}
            median={experimentStats.tokens_total_median ?? 0}
            p95={experimentStats.tokens_total_p95 ?? 0}
            sigma={experimentStats.tokens_total_std ?? 0}
            format={formatTokens}
            brushRange={brush.tokens}
            onBrush={(range) => setBrush((b) => ({ ...b, tokens: range }))}
          />
          <DistributionStrip
            label="Events"
            values={valuesEvents}
            median={experimentStats.event_count_median ?? 0}
            p95={experimentStats.event_count_p95 ?? 0}
            sigma={experimentStats.event_count_std ?? 0}
            format={formatInt}
            brushRange={brush.events}
            onBrush={(range) => setBrush((b) => ({ ...b, events: range }))}
          />
        </div>
      </section>

      <aside
        aria-label="Metrics"
        className="w-[320px] shrink-0 bg-bg-panel border-l border-border-hairline flex flex-col gap-3 p-4 overflow-y-auto"
      >
        {clustersState.status === "ready" ? (
          <RouteMetrics
            mode="group"
            title="Experiment overview"
            subtitle={`${runs.length} runs · ${runs.filter((r) => r.outcome === "pass").length} pass`}
            metrics={experimentStats}
          />
        ) : null}
      </aside>
    </AppShell>
  );
}

// ----- subcomponents -----

interface FilterChipRowProps {
  outcome: OutcomeFilter;
  onOutcome: (o: OutcomeFilter) => void;
  clusters: ClusterSummary[];
  selectedClusters: Set<number>;
  onToggleCluster: (cid: number) => void;
}

function FilterChipRow({
  outcome,
  onOutcome,
  clusters,
  selectedClusters,
  onToggleCluster,
}: FilterChipRowProps) {
  const sortedClusters = [...clusters].sort((a, b) => {
    if (a.clusterId === 0) return 1;
    if (b.clusterId === 0) return -1;
    return b.size - a.size;
  });
  return (
    <div className="px-5 pb-3 flex flex-wrap items-center gap-2 text-xs font-mono">
      <span className="text-text-tertiary uppercase tracking-wide mr-1">
        outcome
      </span>
      {(["pass", "fail", "error"] as const).map((o) => (
        <Chip
          key={o}
          active={outcome === o}
          onClick={() => onOutcome(outcome === o ? null : o)}
        >
          {o}
        </Chip>
      ))}
      <span className="text-text-tertiary uppercase tracking-wide ml-3 mr-1">
        cluster
      </span>
      {sortedClusters.map((c) => (
        <Chip
          key={c.clusterId}
          active={selectedClusters.has(c.clusterId)}
          onClick={() => onToggleCluster(c.clusterId)}
        >
          {c.clusterId === 0 ? "no-route" : `c${c.clusterId}`} · {c.size}
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "px-2 py-1 rounded-sm border transition-colors",
        active
          ? "bg-accent-primary text-bg-canvas border-accent-primary"
          : "bg-bg-elevated text-text-secondary border-border-hairline hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}

interface GraphCanvasProps {
  graphState: "loading" | "ready" | "error";
  graph: { nodes: any[]; edges: any[] } | null;
  runs: RunSummary[];
  touchedNodesByRun: Record<string, Set<string>>;
  filterPending: boolean;
  emptyFilter: boolean;
  /** Number of runs currently in scope. Lets the empty-graph copy
   *  distinguish "no runs matched" from "runs matched but captured
   *  no trace events" — the second is the no-route-cluster case. */
  selectedRunCount: number;
  repoView: RepoView;
  repoTree: import("../api/routes").RepoTreeNode | null;
}

function GraphCanvas({
  graphState,
  graph,
  runs,
  touchedNodesByRun,
  filterPending,
  emptyFilter,
  selectedRunCount,
  repoView,
  repoTree,
}: GraphCanvasProps) {
  // Fixed render box — the SimCity-style spread relies on stable viewport
  // dimensions so the force simulation lands in a reproducible layout.
  const W = 920;
  const H = 540;
  if (graphState === "loading") {
    return (
      <div className="text-text-secondary text-sm font-mono">
        Loading aggregate…
      </div>
    );
  }
  if (graphState === "error") {
    return (
      <div className="text-status-danger text-sm font-mono">
        Failed to load aggregate.
      </div>
    );
  }
  if (emptyFilter) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary font-mono text-sm">
        No runs match the current filters.
      </div>
    );
  }
  if (!graph) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary font-mono text-sm">
        {filterPending ? "Recomputing…" : "No graph data."}
      </div>
    );
  }
  // Graph response is empty but runs ARE selected — the no-route-cluster
  // case. The runs captured zero trace events, so no graph can be built.
  if (graph.nodes.length === 0 && selectedRunCount > 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-text-tertiary font-mono text-sm gap-2">
        <span className="text-text-secondary">
          {selectedRunCount} run{selectedRunCount === 1 ? "" : "s"} selected,
          no trace events captured
        </span>
        <span className="text-xs">
          These runs failed before producing any tool/file events, so no
          aggregate graph exists for them.
        </span>
      </div>
    );
  }
  return (
    <div className="flex-1 flex items-center justify-center min-w-0 min-h-0 relative">
      {filterPending ? (
        <div className="absolute top-2 right-2 text-xs font-mono text-text-tertiary z-10">
          recomputing…
        </div>
      ) : null}
      <div className="relative" style={{ width: W, height: H }}>
        {repoView === "treemap" && repoTree ? (
          <TreemapBackdrop tree={repoTree} width={W} height={H} opacity={1} />
        ) : null}
        <div className="relative" style={{ width: W, height: H }}>
          {repoView === "directory" && repoTree ? (
            <DirectoryLayoutGraph
              nodes={graph.nodes as any}
              edges={graph.edges as any}
              repoTree={repoTree}
              width={W}
              height={H}
              passRateByNode={computePassRateByNode(runs, touchedNodesByRun)}
            />
          ) : repoView === "icicle" && repoTree ? (
            <IcicleBackdrop
              repoTree={repoTree}
              touchedFiles={(graph.nodes as any[]).filter(
                (n) => n.kind === "file" && !!n.target,
              )}
              width={W}
              height={H}
            />
          ) : repoView === "force" && repoTree ? (
            <ForceGraph
              repoTree={repoTree}
              touchedFiles={(graph.nodes as any[]).filter(
                (n) => n.kind === "file" && !!n.target,
              )}
              passRateByNode={(() => {
                const base = computePassRateByNode(runs, touchedNodesByRun);
                const remapped: Record<string, number> = {};
                for (const n of graph.nodes as any[]) {
                  if (n.kind !== "file" || !n.target) continue;
                  const rate = base[n.id];
                  if (rate != null) remapped[`f:${n.target}`] = rate;
                }
                return remapped;
              })()}
              width={W}
              height={H}
            />
          ) : repoView === "conformance" && repoTree ? (
            <ConformanceGraph
              nodes={graph.nodes as any}
              edges={graph.edges as any}
              repoTree={repoTree}
              width={W}
              height={H}
            />
          ) : (
            <AggregateRouteGraph
              nodes={graph.nodes as any}
              edges={graph.edges as any}
              runs={runs}
              touchedNodesByRun={touchedNodesByRun}
              width={W}
              height={H}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Mirror of the per-node pass-rate calculation in AggregateRouteGraph,
 *  used here for the directory-layout variant. Kept local rather than
 *  exported because the two graphs may diverge on weighting later. */
function computePassRateByNode(
  runs: RunSummary[],
  touchedNodesByRun: Record<string, Set<string>>,
): Record<string, number> {
  if (runs.length === 0) return {};
  const passing = new Set(
    runs.filter((r) => r.outcome === "pass").map((r) => r.runId),
  );
  const acc: Record<string, { pass: number; total: number }> = {};
  for (const r of runs) {
    const touched = touchedNodesByRun[r.runId];
    if (!touched) continue;
    const ispass = passing.has(r.runId);
    for (const nid of touched) {
      if (!acc[nid]) acc[nid] = { pass: 0, total: 0 };
      acc[nid].total += 1;
      if (ispass) acc[nid].pass += 1;
    }
  }
  const out: Record<string, number> = {};
  for (const [nid, v] of Object.entries(acc)) {
    out[nid] = v.total > 0 ? v.pass / v.total : 0;
  }
  return out;
}

// ----- Repo-view selector chip group -----

interface RepoViewSelectorProps {
  value: RepoView;
  onChange: (v: RepoView) => void;
  fileCount: number | null;
  touchedCount: number | null;
}

function RepoViewSelector({
  value,
  onChange,
  fileCount,
  touchedCount,
}: RepoViewSelectorProps) {
  const options: { id: RepoView; label: string }[] = [
    { id: "off", label: "Off" },
    { id: "treemap", label: "Treemap" },
    { id: "directory", label: "Dir layout" },
    { id: "icicle", label: "Icicle" },
    { id: "force", label: "Force graph" },
    { id: "conformance", label: "Conformance" },
  ];
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className="uppercase tracking-wide text-text-tertiary">
        repo view
      </span>
      <div className="flex items-center bg-bg-elevated border border-border-hairline rounded-sm p-0.5">
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className={clsx(
                "px-2 py-1 rounded-sm transition-colors",
                active
                  ? "bg-accent-primary text-bg-canvas"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {value !== "off" && fileCount != null && touchedCount != null ? (
        <>
          <span className="text-text-tertiary">
            {touchedCount}/{fileCount} files touched
          </span>
          <span className="flex items-center gap-1 text-text-tertiary">
            <span
              className="inline-block w-2 h-2 rounded-sm"
              style={{ backgroundColor: "var(--color-accent-primary, #38bdf8)" }}
            />
            touched
            <span
              className="inline-block w-2 h-2 rounded-sm ml-2"
              style={{
                backgroundColor:
                  "color-mix(in oklch, var(--color-text-tertiary, #6b7280) 35%, transparent)",
              }}
            />
            untouched
          </span>
        </>
      ) : null}
    </div>
  );
}
