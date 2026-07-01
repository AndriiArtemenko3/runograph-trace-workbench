import { useMemo, useState } from "react";
import * as d3 from "d3";
import clsx from "clsx";
import type { GraphNode, RepoTreeNode } from "../../api/routes";

/**
 * In-canvas icicle backdrop — renders the repo hierarchy as horizontal
 * partition rectangles. Each row of cells = one directory depth. Column
 * width is proportional to the descendant file count.
 *
 * Click a directory tile to zoom in (D3's classic zoomable icicle). The
 * canvas always shows "the repo as a whole" at the current zoom level —
 * top-level repo at start, drillable to any directory.
 *
 * Touched files have a bright accent overlay so the user sees coverage
 * within whichever zoom they're on.
 */

export interface IcicleBackdropProps {
  repoTree: RepoTreeNode;
  touchedFiles: GraphNode[];
  width: number;
  height: number;
  className?: string;
}

interface IcItem {
  name: string;
  kind: "dir" | "file";
  path?: string;
  value: number;
  visits: number;
  totalFiles: number;
  children?: IcItem[];
}

const MIN_FILE_BYTES = 256;

function toHier(node: RepoTreeNode): IcItem {
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
    children: (node.children ?? []).map(toHier),
  };
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  depth: number;
  data: IcItem;
}

export function IcicleBackdrop({
  repoTree,
  touchedFiles,
  width,
  height,
  className,
}: IcicleBackdropProps) {
  const [focusPath, setFocusPath] = useState<string[]>([]);

  // 1. Build the full partition layout once. We'll re-project for zoom.
  const root = useMemo(() => {
    const hier = d3
      .hierarchy<IcItem>(toHier(repoTree))
      .sum((d) => (d.kind === "file" ? d.value : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const part = d3
      .partition<IcItem>()
      .size([width, height])
      .padding(1);
    return part(hier);
  }, [repoTree, width, height]);

  // 2. Resolve focus node by walking focusPath down the tree.
  const focusNode = useMemo(() => {
    let node: d3.HierarchyRectangularNode<IcItem> = root;
    for (const part of focusPath) {
      const child = node.children?.find((c) => c.data.name === part);
      if (!child) break;
      node = child as d3.HierarchyRectangularNode<IcItem>;
    }
    return node;
  }, [root, focusPath]);

  // 3. Compute per-node rect projected through the zoom transform so the
  //    focus dir spans the full width and depth restarts at row 0.
  const { rects, maxDepth } = useMemo(() => {
    const rs: Rect[] = [];
    const fx0 = focusNode.x0;
    const fx1 = focusNode.x1;
    const fDepth = focusNode.depth;
    const fw = Math.max(fx1 - fx0, 1);
    // Show 6 depth levels max from the focus (icicle gets unreadable past that).
    const depthLimit = 6;
    const rowH = height / depthLimit;
    let mDepth = 0;
    root.each((node) => {
      const n = node as d3.HierarchyRectangularNode<IcItem>;
      const relDepth = n.depth - fDepth;
      if (relDepth < 0 || relDepth >= depthLimit) return;
      // Skip nodes outside the focus subtree
      if (n.x1 <= fx0 || n.x0 >= fx1) return;
      const x0 = ((n.x0 - fx0) / fw) * width;
      const x1 = ((n.x1 - fx0) / fw) * width;
      const y0 = relDepth * rowH;
      const y1 = y0 + rowH;
      rs.push({ x0, y0, x1, y1, depth: relDepth, data: n.data });
      if (relDepth > mDepth) mDepth = relDepth;
    });
    return { rects: rs, maxDepth: mDepth };
  }, [root, focusNode, width, height]);

  // 4. Pre-compute touched-file paths for quick lookup
  const touchedPathSet = useMemo(() => {
    return new Set(touchedFiles.map((n) => n.target).filter(Boolean));
  }, [touchedFiles]);

  // 5. Click handler: zoom into a dir, or zoom out one level
  const handleClick = (data: IcItem, depth: number) => {
    if (data.kind !== "dir") return;
    if (depth === 0) {
      // Clicking the focus itself = zoom out one level
      setFocusPath((p) => p.slice(0, -1));
      return;
    }
    // Walk down: append the names along the path from focus to clicked
    setFocusPath((p) => [...p, data.name]);
  };

  // Breadcrumb of current focus path
  const crumb = ["repo", ...focusPath].join(" / ");

  return (
    <div className={clsx("relative", className)} style={{ width, height }}>
      <div
        className="absolute top-1 left-2 z-10 font-mono text-xs text-text-secondary bg-bg-canvas/80 px-1.5 py-0.5 rounded-sm pointer-events-none"
        style={{ maxWidth: width - 12 }}
      >
        {crumb}
        {focusPath.length > 0 && (
          <button
            type="button"
            onClick={() => setFocusPath((p) => p.slice(0, -1))}
            className="ml-3 text-text-tertiary hover:text-text-primary pointer-events-auto"
          >
            ↑ up
          </button>
        )}
      </div>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
        role="img"
        aria-label={`Repo icicle, depth ${maxDepth + 1} from ${crumb}`}
      >
        {rects.map((r, i) => {
          const w = r.x1 - r.x0;
          const h = r.y1 - r.y0;
          if (w < 1 || h < 1) return null;
          const v = r.data.visits;
          const isTouched =
            r.data.kind === "file" && r.data.path != null && touchedPathSet.has(r.data.path);
          const visitsFill = isTouched
            ? "var(--color-accent-primary, #38bdf8)"
            : v > 0
              ? `color-mix(in oklch, var(--color-accent-primary, #38bdf8) ${Math.min(75, 15 + Math.log10(v + 1) * 25)}%, transparent)`
              : `color-mix(in oklch, var(--color-text-tertiary, #6b7280) ${Math.max(8, 18 - r.depth * 2)}%, transparent)`;
          const labelable = w > 36 && h > 12;
          return (
            <g
              key={`r-${i}`}
              onClick={() => handleClick(r.data, r.depth)}
              className={r.data.kind === "dir" ? "cursor-pointer" : "cursor-default"}
            >
              <rect
                x={r.x0}
                y={r.y0}
                width={w}
                height={h}
                fill={visitsFill}
                fillOpacity={isTouched ? 0.85 : 1}
                stroke="color-mix(in oklch, var(--color-text-tertiary, #6b7280) 30%, transparent)"
                strokeWidth={0.5}
              >
                <title>
                  {r.data.name} · {r.data.kind}
                  {r.data.kind === "dir"
                    ? ` · ${r.data.totalFiles} files`
                    : ` · ${(r.data as IcItem).visits > 0 ? `${(r.data as IcItem).visits} visits` : "untouched"}`}
                </title>
              </rect>
              {labelable && (
                <text
                  x={r.x0 + 4}
                  y={r.y0 + h / 2 + 3}
                  fontSize={Math.min(11, h - 4)}
                  className={clsx(
                    "font-mono",
                    isTouched
                      ? "fill-bg-canvas"
                      : v > 0
                        ? "fill-text-primary"
                        : "fill-text-secondary",
                  )}
                  style={{ fontFamily: "var(--font-mono, monospace)" }}
                >
                  {r.data.name.slice(0, Math.floor(w / 6))}
                  {r.data.kind === "dir" && w > 80 ? (
                    <tspan dx={4} className="fill-text-tertiary" fontSize={9}>
                      {r.data.totalFiles}f
                      {v > 0 ? ` · ${v}v` : ""}
                    </tspan>
                  ) : null}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
