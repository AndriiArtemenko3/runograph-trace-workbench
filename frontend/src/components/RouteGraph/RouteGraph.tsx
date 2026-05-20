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
}

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

    const sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.id)
          .distance(35)
          .strength(0.6),
      )
      .force("charge", d3.forceManyBody<SimNode>().strength(-120))
      .force("center", d3.forceCenter<SimNode>(width / 2, height / 2))
      .force(
        "collide",
        d3.forceCollide<SimNode>((d) => nodeRadius(d.data.visits) + 2),
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
          const fillClass = KIND_FILL[n.kind] ?? "fill-text-tertiary";
          const strokeClass = KIND_STROKE[n.kind] ?? "stroke-text-tertiary";
          return (
            <g key={n.id} className="cursor-default">
              <circle
                cx={p.x}
                cy={p.y}
                r={r}
                className={clsx(fillClass, strokeClass)}
                fillOpacity={0.45}
                strokeWidth={1.5}
              >
                <title>
                  {n.target} · {n.kind} · visits {n.visits} ·{" "}
                  {n.avgTimeSeconds.toFixed(2)}s avg
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
