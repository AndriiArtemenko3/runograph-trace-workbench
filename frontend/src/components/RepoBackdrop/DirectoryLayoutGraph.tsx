import { useMemo } from "react";
import * as d3 from "d3";
import clsx from "clsx";
import type { GraphNode, GraphEdge, RepoTreeNode } from "../../api/routes";

/**
 * Directory-layout view — every file in the repo is a circle, packed
 * within its parent directory using D3 pack(). The result is a "city
 * map": you see the full repo population, with touched files highlighted
 * in accent color. Bash/tool nodes (no repo path) cluster in a separate
 * actions zone bottom-right.
 *
 * This replaces the original prototype-B which only drew directory
 * bubbles for the ~4 dirs that had touched files. That prototype hid
 * 99% of the repo. This one shows all 3000+ files at once.
 */

export interface DirectoryLayoutGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  repoTree: RepoTreeNode;
  width: number;
  height: number;
  className?: string;
  passRateByNode?: Record<string, number>;
}

interface PackItem {
  name: string;
  kind: "dir" | "file";
  path?: string;
  value: number;
  visits: number;
  totalFiles: number;
  children?: PackItem[];
}

const MIN_FILE_BYTES = 256;
const ACTIONS_REGION_FRACTION = 0.22; // bottom-right zone for tool/bash nodes

function toPackHierarchy(node: RepoTreeNode): PackItem {
  if (node.kind === "file") {
    return {
      name: node.name,
      kind: "file",
      path: node.path,
      value: Math.max(node.size ?? 0, MIN_FILE_BYTES),
      visits: node.visits,
      totalFiles: 1,
    };
  }
  return {
    name: node.name || "(root)",
    kind: "dir",
    value: 0,
    visits: node.totalVisits,
    totalFiles: node.totalFiles,
    children: (node.children ?? []).map(toPackHierarchy),
  };
}

const PASS_RATE_FILL = (rate: number): string => {
  if (rate >= 0.8) return "var(--color-status-success, #4ade80)";
  if (rate <= 0.2) return "var(--color-status-danger, #f87171)";
  if (rate >= 0.5) {
    const t = (rate - 0.5) / 0.3;
    return `color-mix(in oklch, var(--color-text-tertiary, #6b7280) ${(1 - t) * 100}%, var(--color-status-success, #4ade80) ${t * 100}%)`;
  }
  const t = (0.5 - rate) / 0.3;
  return `color-mix(in oklch, var(--color-text-tertiary, #6b7280) ${(1 - t) * 100}%, var(--color-status-danger, #f87171) ${t * 100}%)`;
};

export function DirectoryLayoutGraph({
  nodes,
  edges: _edges,
  repoTree,
  width,
  height,
  className,
  passRateByNode,
}: DirectoryLayoutGraphProps) {
  // Reserve a strip on the right for bash/tool actions; the pack uses
  // the remaining left region for the file-system view.
  const packWidth = width * (1 - ACTIONS_REGION_FRACTION);
  const packHeight = height;

  // 1. Build the D3 pack layout once. `pack()(hier)` returns a
  //    HierarchyCircularNode so x/y/r are typed.
  const packLayout = useMemo(() => {
    const hier = d3
      .hierarchy<PackItem>(toPackHierarchy(repoTree))
      .sum((d) => (d.kind === "file" ? d.value : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const packer = d3
      .pack<PackItem>()
      .size([packWidth, packHeight])
      .padding(1.5);
    return packer(hier);
  }, [repoTree, packWidth, packHeight]);

  // 2. Index touched files by their relative path so we can lookup pack
  //    coordinates when overlaying the touched-state ring.
  const fileNodesByPath = useMemo(() => {
    const m = new Map<string, d3.HierarchyCircularNode<PackItem>>();
    packLayout.each((n) => {
      if (n.data.kind === "file" && n.data.path) {
        m.set(n.data.path, n as d3.HierarchyCircularNode<PackItem>);
      }
    });
    return m;
  }, [packLayout]);

  // 3. Separate the graph nodes into file vs action.
  const { fileGraphNodes, actionGraphNodes } = useMemo(() => {
    const fileN: GraphNode[] = [];
    const actionN: GraphNode[] = [];
    for (const n of nodes) {
      if (n.kind === "file" && n.target && fileNodesByPath.has(n.target)) {
        fileN.push(n);
      } else {
        actionN.push(n);
      }
    }
    return { fileGraphNodes: fileN, actionGraphNodes: actionN };
  }, [nodes, fileNodesByPath]);

  // 4. Layout action nodes in a simple grid bottom-right.
  const actionPositions = useMemo(() => {
    const grid = new Map<string, { x: number; y: number }>();
    const x0 = packWidth + 12;
    const y0 = 24;
    const colW = width * ACTIONS_REGION_FRACTION - 24;
    const cols = 2;
    const cellW = colW / cols;
    const cellH = 28;
    actionGraphNodes.forEach((n, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      grid.set(n.id, { x: x0 + col * cellW + cellW / 2, y: y0 + row * cellH });
    });
    return grid;
  }, [actionGraphNodes, packWidth, width]);

  // Collect things to render. Walk pack tree once.
  type DirRender = {
    x: number;
    y: number;
    r: number;
    depth: number;
    name: string;
    totalFiles: number;
    visits: number;
  };
  type FileRender = {
    x: number;
    y: number;
    r: number;
    visits: number;
    name: string;
    path?: string;
  };
  const dirs: DirRender[] = [];
  const files: FileRender[] = [];
  packLayout.each((node) => {
    const n = node as d3.HierarchyCircularNode<PackItem>;
    if (n.depth === 0) return;
    if (n.data.kind === "dir") {
      dirs.push({
        x: n.x,
        y: n.y,
        r: n.r,
        depth: n.depth,
        name: n.data.name,
        totalFiles: n.data.totalFiles,
        visits: n.data.visits,
      });
    } else {
      files.push({
        x: n.x,
        y: n.y,
        r: n.r,
        visits: n.data.visits,
        name: n.data.name,
        path: n.data.path,
      });
    }
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={clsx("block", className)}
      role="img"
      aria-label={`Repo directory layout: ${files.length} files, ${fileGraphNodes.length} touched`}
    >
      {/* Top-level directory plates — drawn deepest-first so labels read above */}
      {dirs.map((d, i) => {
        const opacityByDepth = Math.max(0.04, 0.18 - d.depth * 0.04);
        const strokeOp = Math.max(0.12, 0.38 - d.depth * 0.08);
        return (
          <circle
            key={`dir-${i}-${d.name}`}
            cx={d.x}
            cy={d.y}
            r={d.r}
            fill={`color-mix(in oklch, var(--color-text-tertiary, #6b7280) ${opacityByDepth * 100}%, transparent)`}
            stroke={`color-mix(in oklch, var(--color-text-tertiary, #6b7280) ${strokeOp * 100}%, transparent)`}
            strokeWidth={d.depth === 1 ? 1.4 : 0.6}
          />
        );
      })}
      {/* Faint untouched-file dots — every file in the repo */}
      {files.map((f, i) => {
        if (f.r < 0.6) return null;
        const touched = f.visits > 0;
        if (touched) return null;
        return (
          <circle
            key={`f-${i}`}
            cx={f.x}
            cy={f.y}
            r={Math.max(f.r, 1)}
            fill="color-mix(in oklch, var(--color-text-tertiary, #6b7280) 35%, transparent)"
          />
        );
      })}
      {/* Touched-file circles — bright, sized by visit, pass-rate fill */}
      {fileGraphNodes.map((n) => {
        const pos = fileNodesByPath.get(n.target);
        if (!pos) return null;
        const r = Math.min(Math.sqrt(n.visits) * 2.2 + 4, 14);
        const rate = passRateByNode?.[n.id];
        const fill =
          rate != null && Number.isFinite(rate)
            ? PASS_RATE_FILL(rate)
            : "var(--color-accent-primary, #38bdf8)";
        return (
          <g key={`tf-${n.id}`}>
            {n.errorCount > 0 ? (
              <circle
                cx={pos.x}
                cy={pos.y}
                r={r + 3}
                fill="none"
                className="stroke-status-danger"
                strokeWidth={1}
                strokeDasharray="2 2"
                opacity={0.7}
              />
            ) : null}
            <circle
              cx={pos.x}
              cy={pos.y}
              r={r}
              fill={fill}
              fillOpacity={0.85}
              stroke={fill}
              strokeWidth={1.5}
            >
              <title>
                {n.target} · visits {n.visits}
                {rate != null && Number.isFinite(rate)
                  ? ` · pass rate ${Math.round((rate as number) * 100)}%`
                  : ""}
                {n.errorCount > 0 ? ` · errors ${n.errorCount}` : ""}
              </title>
            </circle>
            <text
              x={pos.x}
              y={pos.y + r + 9}
              textAnchor="middle"
              className="fill-text-secondary"
              style={{
                fontSize: 9,
                fontFamily: "var(--font-mono, monospace)",
                paintOrder: "stroke",
                stroke: "var(--color-bg-canvas, #0b0e14)",
                strokeWidth: 3,
              }}
            >
              {(n.target || "").split("/").pop()?.slice(0, 16) || ""}
            </text>
          </g>
        );
      })}
      {/* Top-level dir labels */}
      {dirs
        .filter((d) => d.depth === 1)
        .map((d) => {
          const labelText = `${d.name} ${d.totalFiles}f${d.visits > 0 ? ` · ${d.visits}v` : ""}`;
          // Place label above the bubble
          return (
            <g key={`label-${d.name}`}>
              <rect
                x={d.x - (labelText.length * 6.2) / 2}
                y={d.y - d.r - 14}
                width={labelText.length * 6.2}
                height={13}
                fill="var(--color-bg-canvas, #0b0e14)"
                fillOpacity={0.78}
              />
              <text
                x={d.x}
                y={d.y - d.r - 4}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                className="fill-text-primary font-mono"
                style={{ fontFamily: "var(--font-mono, monospace)" }}
              >
                {d.name}{" "}
                <tspan
                  fontWeight={400}
                  className={d.visits > 0 ? "fill-accent-primary" : "fill-text-tertiary"}
                >
                  {d.totalFiles}f{d.visits > 0 ? ` · ${d.visits}v` : ""}
                </tspan>
              </text>
            </g>
          );
        })}
      {/* Actions region — separator + label */}
      <line
        x1={packWidth + 4}
        y1={12}
        x2={packWidth + 4}
        y2={height - 12}
        stroke="color-mix(in oklch, var(--color-text-tertiary, #6b7280) 25%, transparent)"
        strokeDasharray="3 3"
        strokeWidth={0.75}
      />
      <text
        x={packWidth + 12}
        y={16}
        fontSize={10}
        className="fill-text-tertiary font-mono"
        style={{ fontFamily: "var(--font-mono, monospace)" }}
      >
        TOOLS / BASH ({actionGraphNodes.length})
      </text>
      {/* Action nodes (bash, grep, ls, etc.) */}
      {actionGraphNodes.map((n) => {
        const p = actionPositions.get(n.id);
        if (!p) return null;
        const r = Math.min(Math.sqrt(n.visits) * 2 + 3, 9);
        const rate = passRateByNode?.[n.id];
        const fill =
          rate != null && Number.isFinite(rate)
            ? PASS_RATE_FILL(rate)
            : "var(--color-status-info, #38bdf8)";
        return (
          <g key={`act-${n.id}`}>
            <circle cx={p.x - 14} cy={p.y} r={r} fill={fill} fillOpacity={0.85}>
              <title>
                {n.target} · {n.kind} · visits {n.visits}
              </title>
            </circle>
            <text
              x={p.x - 14 + r + 6}
              y={p.y + 3}
              fontSize={9}
              className="fill-text-secondary font-mono"
              style={{ fontFamily: "var(--font-mono, monospace)" }}
            >
              {(n.target || "").slice(0, 16)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
