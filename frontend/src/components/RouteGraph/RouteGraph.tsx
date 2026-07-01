import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import clsx from "clsx";
import type { GraphNode, GraphEdge } from "../../api/routes";

/**
 * Force-directed route graph. React owns the DOM (renders <circle> +
 * <line>); D3 owns the simulation. Each tick flushes the positions
 * back into React state so the SVG re-renders.
 *
 * Tailwind tokens follow the existing palette: accent-primary for
 * file nodes, status-* for action nodes, border-* for edges. Node
 * radius scales with visits, edge stroke-width scales with count.
 */

const KIND_FILL: Record<string, string> = {
  file: "fill-accent-primary",
  "action:test": "fill-status-success",
  "action:tool": "fill-status-info",
  "action:error": "fill-status-danger",
  "action:reflection": "fill-text-secondary",
  "action:final": "fill-text-primary",
};

const KIND_STROKE: Record<string, string> = {
  file: "stroke-accent-primary",
  "action:test": "stroke-status-success",
  "action:tool": "stroke-status-info",
  "action:error": "stroke-status-danger",
  "action:reflection": "stroke-text-secondary",
  "action:final": "stroke-text-primary",
};

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  data: GraphNode;
}

interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
  data: GraphEdge;
}

export interface RouteGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
  className?: string;
  /** Show node labels (file basenames). Off for mini-graphs. */
  labels?: boolean;
  /** Settle the simulation for at most this many milliseconds. */
  settleMs?: number;
  /** Optional per-node pass rate ∈ [0, 1]. When supplied, node fill
   *  interpolates green → grey → red instead of using the kind palette.
   *  Aggregate views pass this in; per-run views leave it undefined. */
  passRateByNode?: Record<string, number>;
  /** Optional click handler on nodes — receives the node id. */
  onNodeClick?: (id: string) => void;
}

const PASS_RATE_FILL = (rate: number): string => {
  // Three-stop palette tuned to Geist/Tailwind status tokens.
  // ≥ 0.8 -> success, ~0.5 -> tertiary text grey, ≤ 0.2 -> danger.
  if (rate >= 0.8) return "var(--color-status-success, #4ade80)";
  if (rate <= 0.2) return "var(--color-status-danger, #f87171)";
  if (rate >= 0.5) {
    // Mid-high: blend success → grey
    const t = (rate - 0.5) / 0.3;
    return `color-mix(in oklch, var(--color-text-tertiary, #6b7280) ${(1 - t) * 100}%, var(--color-status-success, #4ade80) ${t * 100}%)`;
  }
  // Mid-low: blend grey → danger
  const t = (0.5 - rate) / 0.3;
  return `color-mix(in oklch, var(--color-text-tertiary, #6b7280) ${(1 - t) * 100}%, var(--color-status-danger, #f87171) ${t * 100}%)`;
};

function nodeRadius(visits: number): number {
  return Math.min(Math.sqrt(visits) * 3 + 4, 18);
}

function edgeWidth(count: number): number {
  return Math.min(Math.log(count + 1) * 1.2 + 0.6, 5);
}

function basename(target: string): string {
  if (!target) return "";
  const parts = target.split("/");
  return parts[parts.length - 1] || target;
}

export function RouteGraph({
  nodes,
  edges,
  width = 280,
  height = 200,
  className,
  labels = false,
  settleMs = 1500,
  passRateByNode,
  onNodeClick,
}: RouteGraphProps) {
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  const simRef = useRef<d3.Simulation<SimNode, undefined> | null>(null);

  useEffect(() => {
    if (nodes.length === 0) {
      setPositions(new Map());
      return;
    }

    const simNodes: SimNode[] = nodes.map((n) => ({ id: n.id, data: n }));
    const simEdges: SimEdge[] = edges
      // Drop edges whose endpoints aren't in the node set
      .filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target))
      .map((e) => ({ source: e.source, target: e.target, data: e }));

    // Force tuning scales with the smaller canvas dimension so the same
    // component renders cleanly at 280×200 (cluster mini-card) and 920×540
    // (aggregate canvas). Empirically link distance ~ min/10 and charge
    // strength ~ -min/2 give a stable spread for ≤ ~200 nodes.
    const scale = Math.min(width, height);
    const linkDistance = Math.max(35, scale * 0.12);
    const chargeStrength = -Math.max(120, scale * 0.6);

    const sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.id)
          .distance(linkDistance)
          .strength(0.55),
      )
      .force("charge", d3.forceManyBody<SimNode>().strength(chargeStrength))
      .force("center", d3.forceCenter<SimNode>(width / 2, height / 2))
      .force(
        "collide",
        d3.forceCollide<SimNode>((d) => nodeRadius(d.data.visits) + 4),
      )
      .on("tick", () => {
        setPositions(
          new Map(
            simNodes
              .filter((n) => n.x != null && n.y != null)
              .map((n) => [n.id, { x: n.x as number, y: n.y as number }]),
          ),
        );
      });

    simRef.current = sim;
    const stopTimer = window.setTimeout(() => sim.stop(), settleMs);

    return () => {
      window.clearTimeout(stopTimer);
      sim.stop();
    };
  }, [nodes, edges, width, height, settleMs]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={clsx("block", className)}
      role="img"
      aria-label={`Force-directed graph with ${nodes.length} nodes and ${edges.length} edges`}
    >
      <g aria-hidden="true">
        {edges.map((e) => {
          const s = positions.get(e.source);
          const t = positions.get(e.target);
          if (!s || !t) return null;
          return (
            <line
              key={`${e.source}->${e.target}`}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              className="stroke-border-subtle"
              strokeWidth={edgeWidth(e.count)}
              opacity={0.55}
            />
          );
        })}
      </g>
      <g>
        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const r = nodeRadius(n.visits);
          const rate = passRateByNode?.[n.id];
          const useRateFill = rate != null && Number.isFinite(rate);
          const fillClass = useRateFill
            ? undefined
            : (KIND_FILL[n.kind] ?? "fill-text-tertiary");
          const strokeClass = useRateFill
            ? undefined
            : (KIND_STROKE[n.kind] ?? "stroke-text-tertiary");
          const inlineFill = useRateFill ? PASS_RATE_FILL(rate as number) : undefined;
          const hasErrors = n.errorCount > 0;
          return (
            <g
              key={n.id}
              className={clsx(onNodeClick ? "cursor-pointer" : "cursor-default")}
              onClick={onNodeClick ? () => onNodeClick(n.id) : undefined}
            >
              {hasErrors ? (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={r + 3}
                  fill="none"
                  className="stroke-status-danger"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  opacity={0.7}
                />
              ) : null}
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                className={clsx(fillClass, strokeClass)}
                fill={inlineFill}
                stroke={inlineFill}
                fillOpacity={0.55}
                strokeWidth={1.5}
              >
                <title>
                  {n.target} · {n.kind} · visits {n.visits}
                  {useRateFill ? ` · pass rate ${Math.round((rate as number) * 100)}%` : ""}
                  {hasErrors ? ` · errors ${n.errorCount}` : ""}
                </title>
              </circle>
              {labels ? (() => {
                // Push label away from center to reduce overlap in dense
                // middle. Labels above for top-half nodes, below for bottom.
                const labelBelow = p.y >= height / 2;
                const labelY = labelBelow ? p.y + r + 9 : p.y - r - 4;
                const text = basename(n.target).slice(0, 12);
                return (
                  <>
                    <text
                      x={p.x}
                      y={labelY}
                      textAnchor="middle"
                      className="fill-bg-canvas"
                      style={{ fontSize: 9, strokeWidth: 3, paintOrder: "stroke", stroke: "var(--color-bg-canvas, #0b0e14)" }}
                    >
                      {text}
                    </text>
                    <text
                      x={p.x}
                      y={labelY}
                      textAnchor="middle"
                      className="font-mono fill-text-secondary"
                      style={{ fontSize: 9 }}
                    >
                      {text}
                    </text>
                  </>
                );
              })() : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
