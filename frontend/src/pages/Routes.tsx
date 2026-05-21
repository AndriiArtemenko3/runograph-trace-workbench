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
  useRunsList,
  type ClusterSummary,
  type ClustersResponse,
  type RouteRunResponse,
  type RunSummary,
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

/** Per-outcome run buckets for a cluster — used to colour dots, drive the
 *  outcome-mix subtitle on the metrics card, and inform the size-weighted
 *  baseline. */
interface OutcomeMix {
  pass: number;
  fail: number;
  error: number;
  total: number;
}

function outcomeMixFor(
  cluster: ClusterSummary,
  runsById: Map<string, RunSummary>,
): OutcomeMix {
  const mix: OutcomeMix = { pass: 0, fail: 0, error: 0, total: 0 };
  for (const rid of cluster.memberRunIds) {
    const r = runsById.get(rid);
    mix.total += 1;
    if (!r) continue;
    if (r.outcome === "pass") mix.pass += 1;
    else if (r.outcome === "fail") mix.fail += 1;
    else mix.error += 1;
  }
  return mix;
}

function dotClassFor(outcome: string | undefined): string {
  if (outcome === "pass") return "bg-status-success";
  if (outcome === "fail") return "bg-status-danger";
  return "bg-text-tertiary";
}

/** Map cost → 4-10 px radius via sqrt; tight clusters stay readable. */
function dotPixelsFor(
  cost: number | undefined,
  maxCost: number,
): { width: number; height: number } {
  const safeMax = maxCost > 0 ? maxCost : 1;
  const c = cost && cost > 0 ? cost : 0;
  const norm = Math.sqrt(c / safeMax);
  const px = Math.max(6, Math.min(14, Math.round(6 + norm * 8)));
  return { width: px, height: px };
}

function formatDuration(startedAt: string, endedAt: string): string {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m${r.toString().padStart(2, "0")}s`;
}

function formatCost(usd: number | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function formatTokens(n: number | undefined): string {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function clusterLabel(c: ClusterSummary): string {
  return c.clusterId === 0 ? "No-route" : `Cluster ${c.clusterId}`;
}

/** Left pane is sorted by size descending; No-route pins to the bottom
 *  (it's a special class — runs with no captured trace). */
function sortClustersForLeftPane(clusters: ClusterSummary[]): ClusterSummary[] {
  return [...clusters].sort((a, b) => {
    if (a.clusterId === 0) return 1;
    if (b.clusterId === 0) return -1;
    return b.size - a.size;
  });
}

function buildLeftPaneSections(
  clusters: ClusterSummary[],
  expandedClusterIds: ReadonlySet<number>,
  selectedClusterId: number | null,
  selectedRunId: string | null,
): LeftPaneSection[] {
  const sorted = sortClustersForLeftPane(clusters);
  const sections: LeftPaneSection[] = [
    {
      title: "Clusters",
      rows: sorted.map((c) => {
        const expanded = expandedClusterIds.has(c.clusterId);
        return {
          label: clusterLabel(c),
          // Caret hints the row toggles expansion (▾ open, ▸ closed).
          value: `${c.size} ${expanded ? "▾" : "▸"}`,
          selected: c.clusterId === selectedClusterId,
        };
      }),
    },
  ];

  // Append one runs sub-section per expanded cluster (in display order).
  for (const c of sorted) {
    if (!expandedClusterIds.has(c.clusterId)) continue;
    if (c.memberRunIds.length === 0) continue;
    sections.push({
      title: `${clusterLabel(c)} runs`,
      rows: c.memberRunIds.map((rid) => ({
        label: rid.replace(/^runograph-50-/, ""),
        value: rid === c.representativeRunId ? "rep" : "",
        selected: rid === selectedRunId,
      })),
    });
  }
  return sections;
}

function ClusterCard({
  cluster,
  onSelect,
  outcomeMix,
}: {
  cluster: ClusterSummary;
  onSelect: () => void;
  outcomeMix: OutcomeMix | null;
}) {
  const isEmpty = cluster.representativeGraph.nodes.length === 0;
  const nodeCount = cluster.representativeGraph.nodes.length;
  const seqLen = cluster.representativeGraph.sequenceLength;
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
          {clusterLabel(cluster)}
        </h3>
        <span className="font-mono text-xs text-text-tertiary tabular-nums">
          {cluster.size} {cluster.size === 1 ? "run" : "runs"}
          {outcomeMix && outcomeMix.total > 0 ? (
            <>
              {" · "}
              <span className="text-status-success">{outcomeMix.pass}p</span>
              {outcomeMix.fail > 0 ? (
                <>
                  {" "}
                  <span className="text-status-danger">{outcomeMix.fail}f</span>
                </>
              ) : null}
              {outcomeMix.error > 0 ? (
                <>
                  {" "}
                  <span className="text-text-tertiary">{outcomeMix.error}e</span>
                </>
              ) : null}
            </>
          ) : null}
        </span>
      </header>
      <div className="bg-bg-canvas rounded border border-border-subtle flex items-center justify-center min-h-[160px]">
        {isEmpty ? (
          <div className="flex flex-col items-center gap-2 p-3 text-center">
            <span className="text-status-danger text-xs font-mono">
              0 events captured
            </span>
            <span className="text-text-tertiary text-2xs font-mono">
              {cluster.size} {cluster.size === 1 ? "run" : "runs"} failed
              before producing any trace
            </span>
            <div className="flex flex-wrap justify-center gap-1 max-w-[200px]">
              {cluster.memberRunIds.slice(0, 6).map((rid) => (
                <span
                  key={rid}
                  className="font-mono text-2xs px-1.5 py-0.5 rounded bg-bg-elevated text-text-tertiary"
                >
                  {rid.replace(/^runograph-50-/, "")}
                </span>
              ))}
              {cluster.memberRunIds.length > 6 ? (
                <span className="font-mono text-2xs text-text-tertiary">
                  +{cluster.memberRunIds.length - 6}
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <RouteGraph
            nodes={cluster.representativeGraph.nodes}
            edges={cluster.representativeGraph.edges}
            width={300}
            height={180}
          />
        )}
      </div>
      <div className="flex items-center justify-end text-2xs font-mono text-text-tertiary">
        <span>
          {seqLen} {seqLen === 1 ? "event" : "events"}
          {" · "}
          {nodeCount} {nodeCount === 1 ? "node" : "nodes"}
        </span>
      </div>
    </button>
  );
}

function ClusterFocus({
  cluster,
  onRunSelect,
  runsById,
}: {
  cluster: ClusterSummary;
  onRunSelect: (runId: string) => void;
  runsById: Map<string, RunSummary>;
}) {
  // Cost-sizing reference: largest cost within this cluster's members.
  const maxCost = cluster.memberRunIds.reduce((m, rid) => {
    const c = runsById.get(rid)?.totalCostUsd ?? 0;
    return c > m ? c : m;
  }, 0);

  return (
    <article className="flex flex-col gap-3">
      <header>
        <h2 className="font-sans text-lg font-medium text-text-primary">
          {clusterLabel(cluster)}
        </h2>
        <p className="text-text-secondary text-sm">
          {cluster.size} {cluster.size === 1 ? "run" : "runs"} · representative{" "}
          <span className="font-mono text-text-primary">
            {cluster.representativeRunId}
          </span>
        </p>
      </header>
      <div className="bg-bg-panel rounded-md border border-border-hairline p-3">
        {cluster.representativeGraph.nodes.length === 0 ? (
          <div className="flex items-center justify-center min-h-[480px] text-text-tertiary text-sm font-mono">
            (this cluster contains runs that produced no events)
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
          <span className="ml-2 text-text-tertiary text-2xs normal-case tracking-normal font-mono">
            (colour = outcome, size = cost)
          </span>
        </h3>
        <ul className="grid grid-cols-5 gap-1 m-0 p-0 list-none">
          {cluster.memberRunIds.map((rid) => {
            const r = runsById.get(rid);
            const dotPx = dotPixelsFor(r?.totalCostUsd, maxCost);
            const dotCls = dotClassFor(r?.outcome);
            const titleParts = [
              rid,
              r ? r.outcome : "outcome unknown",
              r ? formatCost(r.totalCostUsd) : "",
              r ? `${formatTokens(r.totalTokens)} tok` : "",
            ].filter(Boolean);
            return (
              <li key={rid}>
                <button
                  type="button"
                  onClick={() => onRunSelect(rid)}
                  title={titleParts.join(" · ")}
                  className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-bg-elevated text-left"
                >
                  <span
                    aria-hidden="true"
                    className={clsx("rounded-full shrink-0", dotCls)}
                    style={{ width: dotPx.width, height: dotPx.height }}
                  />
                  <span className="font-mono text-2xs text-text-secondary truncate">
                    {rid.replace(/^runograph-50-/, "")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </article>
  );
}

function RunFocus({
  run,
  summary,
  cluster,
  clusterCostMean,
  costRank,
  onBack,
}: {
  run: RouteRunResponse;
  summary: RunSummary | undefined;
  cluster: ClusterSummary | undefined;
  clusterCostMean: number | null;
  costRank: { rank: number; size: number } | null;
  onBack: () => void;
}) {
  const ratio =
    summary && clusterCostMean && clusterCostMean > 0
      ? summary.totalCostUsd / clusterCostMean
      : null;
  const duration = summary
    ? formatDuration(summary.startedAt, summary.endedAt)
    : "—";
  return (
    <article className="flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
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
          {summary ? (
            <p className="text-text-secondary text-sm font-mono tabular-nums">
              <span className="text-text-primary">
                {summary.eventCount} {summary.eventCount === 1 ? "event" : "events"}
              </span>
              <span className="text-text-tertiary"> · </span>
              <span className="text-text-primary">
                {formatTokens(summary.totalTokens)} tok
              </span>
              <span className="text-text-tertiary"> · </span>
              <span className="text-text-primary">
                {formatCost(summary.totalCostUsd)}
              </span>
              <span className="text-text-tertiary"> · </span>
              <span className="text-text-primary">{duration}</span>
              {ratio && cluster ? (
                <span className="ml-2 text-text-tertiary">
                  ({ratio.toFixed(2)}× {clusterLabel(cluster)} mean
                  {costRank
                    ? `, rank #${costRank.rank} of ${costRank.size}`
                    : ""}
                  )
                </span>
              ) : null}
            </p>
          ) : null}
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
  runs: RunSummary[],
): { left: BottomBarEntry[]; right: BottomBarEntry[] } {
  const totalRuns = data
    ? data.clusters.reduce((acc, c) => acc + c.size, 0)
    : 0;

  const passCount = runs.reduce(
    (n, r) => (r.outcome === "pass" ? n + 1 : n),
    0,
  );
  const spendUsd = runs.reduce((s, r) => s + (r.totalCostUsd ?? 0), 0);
  const passPct = runs.length > 0 ? Math.round((passCount / runs.length) * 100) : null;

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
        detail: data ? `${data.clusters.length} clusters` : "",
      },
    ],
    right: [
      {
        tone: "info",
        label: "agg. graph",
        detail: data ? `${data.aggregateGraph.nodes.length} nodes` : "—",
      },
      {
        tone: "success",
        label: "pass rate",
        detail:
          runs.length > 0 && passPct != null
            ? `${passCount}/${runs.length} (${passPct}%)`
            : "—",
      },
      {
        tone: "warning",
        label: "spend",
        detail: runs.length > 0 ? `$${spendUsd.toFixed(2)}` : "—",
      },
    ],
  };
}

export function Routes() {
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [expandedClusterIds, setExpandedClusterIds] = useState<Set<number>>(
    () => new Set(),
  );

  const clustersState = useRouteClusters(DEFAULT_EXPERIMENT);
  const runsListState = useRunsList(DEFAULT_EXPERIMENT);
  const runState = useRunRoute(selectedRunId);

  const view: ViewMode = useMemo(() => {
    if (selectedRunId) return { kind: "run", runId: selectedRunId };
    if (selectedClusterId != null)
      return { kind: "cluster", clusterId: selectedClusterId };
    return { kind: "overview" };
  }, [selectedClusterId, selectedRunId]);

  const clusters =
    clustersState.status === "ready" ? clustersState.data.clusters : [];

  // Filter runs to the current experiment — backend returns adjacent rows too.
  const runs = useMemo(() => {
    if (runsListState.status !== "ready") return [] as RunSummary[];
    return runsListState.data.filter(
      (r) => r.experimentId === DEFAULT_EXPERIMENT,
    );
  }, [runsListState]);

  const runsById = useMemo(() => {
    const m = new Map<string, RunSummary>();
    for (const r of runs) m.set(r.runId, r);
    return m;
  }, [runs]);

  const activeCluster = clusters.find((c) => c.clusterId === selectedClusterId);
  const sections = buildLeftPaneSections(
    clusters,
    expandedClusterIds,
    selectedClusterId,
    selectedRunId,
  );
  const bottomEntries = buildBottomBarEntries(
    clustersState.status === "ready" ? clustersState.data : null,
    runs,
  );

  // Experiment-wide group_stats — distribution stats over every run with
  // a captured trace. Driven by the backend so the numbers are auditable
  // against the SQLite row set rather than a frontend-side approximation.
  const totalRunsAcrossClusters = clusters.reduce((a, c) => a + c.size, 0);
  const experimentStats: Record<string, number> = useMemo(() => {
    if (clustersState.status !== "ready") return {};
    return clustersState.data.experimentStats ?? {};
  }, [clustersState]);

  // For the run-focus comparative annotation: which cluster owns the run,
  // its mean cost, the run's cost-rank within that cluster.
  const runContext = useMemo(() => {
    if (!selectedRunId)
      return { cluster: undefined, mean: null, rank: null } as {
        cluster: ClusterSummary | undefined;
        mean: number | null;
        rank: { rank: number; size: number } | null;
      };
    const owner = clusters.find((c) =>
      c.memberRunIds.includes(selectedRunId),
    );
    if (!owner) return { cluster: undefined, mean: null, rank: null };
    const costs = owner.memberRunIds
      .map((rid) => runsById.get(rid)?.totalCostUsd ?? 0)
      .filter((x) => x > 0);
    const mean = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
    const sortedDesc = [...owner.memberRunIds].sort(
      (a, b) =>
        (runsById.get(b)?.totalCostUsd ?? 0) -
        (runsById.get(a)?.totalCostUsd ?? 0),
    );
    const idx = sortedDesc.indexOf(selectedRunId);
    return {
      cluster: owner,
      mean,
      rank: idx >= 0 ? { rank: idx + 1, size: owner.memberRunIds.length } : null,
    };
  }, [selectedRunId, clusters, runsById]);

  const handleRowClick = (sectionTitle: string, label: string) => {
    if (sectionTitle === "Clusters") {
      // Toggle expansion only — never auto-navigate. The user opens a
      // cluster's focus view by clicking the corresponding card in the
      // centre pane; the LeftPane is for inspection in place.
      const cid =
        label === "No-route"
          ? 0
          : parseInt(label.replace(/^Cluster\s+/, ""), 10);
      setExpandedClusterIds((prev) => {
        const next = new Set(prev);
        if (next.has(cid)) next.delete(cid);
        else next.add(cid);
        return next;
      });
    } else {
      // Member runs section — label is the abbreviated run id
      setSelectedRunId(`runograph-50-${label}`);
    }
  };

  const rightPane = (() => {
    if (view.kind === "run" && runState.status === "ready") {
      // Run-mode metrics: baseline is the owning cluster's group_stats so
      // the z-score badges read against the local distribution, not the
      // whole experiment.
      const owner = runContext.cluster;
      const subtitleParts = [runState.data.model, runState.data.outcome];
      if (owner) {
        subtitleParts.push(`in ${clusterLabel(owner)}`);
      }
      return (
        <RouteMetrics
          mode="run"
          title={`Run ${runState.data.runId.replace(/^runograph-50-/, "")}`}
          subtitle={subtitleParts.join(" · ")}
          metrics={runState.data.metrics}
          baseline={owner?.metrics}
        />
      );
    }
    if (view.kind === "cluster" && activeCluster) {
      const mix = outcomeMixFor(activeCluster, runsById);
      const parts = [`${activeCluster.size} runs`];
      if (mix.total > 0 && runsById.size > 0) {
        parts.push(`${mix.pass} pass`);
        if (mix.fail > 0) parts.push(`${mix.fail} fail`);
        if (mix.error > 0) parts.push(`${mix.error} err`);
      }
      return (
        <RouteMetrics
          mode="group"
          title={clusterLabel(activeCluster)}
          subtitle={parts.join(" · ")}
          metrics={activeCluster.metrics}
          baseline={experimentStats}
        />
      );
    }
    if (clustersState.status === "ready") {
      const passCount = runs.reduce(
        (n, r) => (r.outcome === "pass" ? n + 1 : n),
        0,
      );
      const subtitleParts = [`${totalRunsAcrossClusters} runs`];
      if (runs.length > 0) subtitleParts.push(`${passCount} pass`);
      return (
        <RouteMetrics
          mode="group"
          title="Experiment overview"
          subtitle={subtitleParts.join(" · ")}
          metrics={experimentStats}
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
            (() => {
              const sortedClusters = sortClustersForLeftPane(
                clustersState.data.clusters,
              );
              return (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 auto-rows-min">
                  {sortedClusters.map((c) => (
                    <ClusterCard
                      key={c.clusterId}
                      cluster={c}
                      outcomeMix={
                        runsById.size > 0 ? outcomeMixFor(c, runsById) : null
                      }
                      onSelect={() => {
                        setSelectedClusterId(c.clusterId);
                        setSelectedRunId(null);
                      }}
                    />
                  ))}
                </div>
              );
            })()
          ) : view.kind === "cluster" && activeCluster ? (
            <ClusterFocus
              cluster={activeCluster}
              onRunSelect={(rid) => setSelectedRunId(rid)}
              runsById={runsById}
            />
          ) : view.kind === "run" && runState.status === "ready" ? (
            <RunFocus
              run={runState.data}
              summary={runsById.get(runState.data.runId)}
              cluster={runContext.cluster}
              clusterCostMean={runContext.mean}
              costRank={runContext.rank}
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
