import { useMemo } from "react";
import * as d3 from "d3";
import clsx from "clsx";
import type { RepoTreeNode } from "../../api/routes";

/**
 * Treemap backdrop — renders the repo file hierarchy as a D3 treemap
 * behind the aggregate force-graph. Tile size = file/dir total bytes;
 * tile fill intensity = visit density (white → accent → strong).
 *
 * The treemap is read-only chrome — it does not capture pointer events.
 * The force-graph layered on top stays fully interactive.
 *
 * Sizing rule: dir tiles sum their descendants' bytes; very small files
 * (< 256 B, mostly `.txt` test fixtures) are coalesced so the layout
 * doesn't degenerate into noise pixels.
 */

export interface TreemapBackdropProps {
  tree: RepoTreeNode;
  width: number;
  height: number;
  className?: string;
  /** Optional opacity multiplier for the entire backdrop. */
  opacity?: number;
}

interface HierItem {
  name: string;
  kind: "dir" | "file";
  path?: string;
  value: number;
  visits: number;
  /** Number of files in this subtree (1 for leaves, sum for dirs). */
  totalFiles: number;
  children?: HierItem[];
}

const MIN_FILE_BYTES = 256;

function toHierarchy(node: RepoTreeNode): HierItem {
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
  // Dir
  const kids = (node.children ?? []).map(toHierarchy);
  return {
    name: node.name || "(root)",
    kind: "dir",
    value: 0,
    visits: node.totalVisits,
    totalFiles: node.totalFiles,
    children: kids,
  };
}

function maxVisitsLeaf(root: d3.HierarchyRectangularNode<HierItem>): number {
  let m = 0;
  root.eachAfter((n) => {
    if (n.data.kind === "file" && n.data.visits > m) m = n.data.visits;
  });
  return Math.max(m, 1);
}

export function TreemapBackdrop({
  tree,
  width,
  height,
  className,
  opacity = 1,
}: TreemapBackdropProps) {
  const layout = useMemo(() => {
    const hier = d3
      .hierarchy<HierItem>(toHierarchy(tree))
      .sum((d) => (d.kind === "file" ? d.value : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const tm = d3
      .treemap<HierItem>()
      .size([width, height])
      .paddingOuter(2)
      .paddingTop((n) => (n.depth === 0 ? 0 : n.depth === 1 ? 14 : 0))
      .paddingInner(1)
      .round(true);
    return tm(hier);
  }, [tree, width, height]);

  const maxVisits = useMemo(() => maxVisitsLeaf(layout), [layout]);

  // Collect: top-level dir labels, leaves to render.
  const topLevelDirs: typeof layout.children = layout.children ?? [];
  const leaves = layout.leaves();

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={clsx("block pointer-events-none absolute inset-0", className)}
      aria-hidden="true"
      style={{ opacity }}
    >
      {/* Top-level dir background plates — each dir gets a distinct subtle
          hue so the structure is readable without labels on every leaf. */}
      {topLevelDirs.map((d, i) => {
        const x0 = d.x0 ?? 0;
        const y0 = d.y0 ?? 0;
        const x1 = d.x1 ?? 0;
        const y1 = d.y1 ?? 0;
        // Two-tone alternation so adjacent dirs separate visually.
        const baseTone = i % 2 === 0 ? 14 : 9;
        return (
          <rect
            key={`plate-${d.data.name}`}
            x={x0}
            y={y0}
            width={x1 - x0}
            height={y1 - y0}
            fill={`color-mix(in oklch, var(--color-text-tertiary, #6b7280) ${baseTone}%, transparent)`}
            stroke="color-mix(in oklch, var(--color-text-tertiary, #6b7280) 45%, transparent)"
            strokeWidth={1}
          />
        );
      })}
      {/* Leaf file tiles */}
      {leaves.map((n) => {
        const x0 = n.x0 ?? 0;
        const y0 = n.y0 ?? 0;
        const x1 = n.x1 ?? 0;
        const y1 = n.y1 ?? 0;
        const w = x1 - x0;
        const h = y1 - y0;
        if (w < 1.5 || h < 1.5) return null;
        const v = n.data.visits;
        const tintLevel =
          v <= 0 ? 0 : Math.min(0.95, 0.5 + 0.45 * Math.log10(v + 1) / Math.log10(maxVisits + 1));
        const fill =
          v > 0
            ? `color-mix(in oklch, var(--color-accent-primary, #38bdf8) ${tintLevel * 100}%, transparent)`
            : "color-mix(in oklch, var(--color-text-tertiary, #6b7280) 28%, transparent)";
        return (
          <rect
            key={n.data.path || `${x0}-${y0}`}
            x={x0}
            y={y0}
            width={w}
            height={h}
            fill={fill}
            stroke="color-mix(in oklch, var(--color-text-tertiary, #6b7280) 35%, transparent)"
            strokeWidth={0.6}
          />
        );
      })}
      {/* Top-level dir labels — bold, readable, with their file count. */}
      {topLevelDirs.map((d) => {
        const x0 = d.x0 ?? 0;
        const y0 = d.y0 ?? 0;
        const x1 = d.x1 ?? 0;
        const w = x1 - x0;
        if (w < 48) return null;
        const totalFiles = d.data.totalFiles;
        const visits = d.data.visits;
        const labelText = `${d.data.name}`;
        const countText =
          visits > 0
            ? `${totalFiles}f · ${visits}v`
            : `${totalFiles}f`;
        return (
          <g key={d.data.name}>
            {/* Backing rect so the label is readable against tiles */}
            <rect
              x={x0 + 2}
              y={y0 + 2}
              width={Math.min(w - 4, 7 * (labelText.length + countText.length) + 24)}
              height={13}
              fill="var(--color-bg-canvas, #0b0e14)"
              fillOpacity={0.78}
            />
            <text
              x={x0 + 6}
              y={y0 + 12}
              fontSize={11}
              fontWeight={600}
              className="fill-text-primary font-mono"
              style={{ fontFamily: "var(--font-mono, monospace)" }}
            >
              {labelText}
              <tspan
                fontSize={9}
                fontWeight={400}
                dx={6}
                className={visits > 0 ? "fill-accent-primary" : "fill-text-tertiary"}
              >
                {countText}
              </tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}
