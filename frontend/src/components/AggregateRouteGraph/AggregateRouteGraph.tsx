import { useMemo } from "react";
import clsx from "clsx";
import { RouteGraph } from "../RouteGraph/RouteGraph";
import type { GraphNode, GraphEdge, RunSummary } from "../../api/routes";

/**
 * Aggregate Route Graph — the single canvas that summarises every run in
 * an experiment as one force-directed graph.
 *
 * Node size  = visits across all selected runs (sqrt, capped).
 * Edge width = transition count (log).
 * Node colour = pass-rate-of-owning-runs at this node (green → grey → red).
 * Halo on node = errorCount > 0 (dashed danger ring + count in tooltip).
 *
 * The component is a thin wrapper around `RouteGraph` that derives the
 * pass-rate-per-node from the run-summary list provided by the parent
 * (so the colour scale is computed off the same raw outcome strings the
 * Indicators panel reads — no synthesised composite metric introduced).
 *
 * Pass-rate per node is computed as:
 *
 *   passing_visits / total_visits
 *
 * where a "visit" at node N counts the union of visits across the
 * selected run set. Because the aggregate graph collapses runs at the
 * node level we use the union approximation: a node touched by R runs
 * inherits pass rate = (#pass-runs touching N) / (#runs touching N).
 * This is the auditable, replicable definition — the user can hover any
 * node and verify the number by counting runs in the SQLite row set.
 */

export interface AggregateRouteGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  runs: RunSummary[];
  /** runId -> set of node ids touched by that run. Pre-computed by the
   *  page caller from the cluster member lists (each cluster's
   *  representativeGraph carries the per-run node set). */
  touchedNodesByRun?: Record<string, Set<string>>;
  width: number;
  height: number;
  onNodeClick?: (id: string) => void;
  className?: string;
}

export function AggregateRouteGraph({
  nodes,
  edges,
  runs,
  touchedNodesByRun,
  width,
  height,
  onNodeClick,
  className,
}: AggregateRouteGraphProps) {
  const passRateByNode = useMemo<Record<string, number>>(() => {
    if (!touchedNodesByRun || runs.length === 0) return {};
    const passing = new Set<string>(
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
  }, [runs, touchedNodesByRun]);

  return (
    <div
      className={clsx("w-full h-full", className)}
      data-canon="aggregate-route-graph"
    >
      <RouteGraph
        nodes={nodes}
        edges={edges}
        width={width}
        height={height}
        labels={true}
        settleMs={2200}
        passRateByNode={passRateByNode}
        onNodeClick={onNodeClick}
      />
    </div>
  );
}
