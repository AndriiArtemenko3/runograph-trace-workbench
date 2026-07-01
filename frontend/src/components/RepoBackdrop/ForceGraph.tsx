import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import clsx from "clsx";
import type { GraphNode, GraphEdge, RepoTreeNode } from "../../api/routes";

/**
 * Canvas-based interactive force graph — every file in the repo as a node,
 * directories as parent nodes, edges = parent→child structure. Pan/zoom,
 * draggable nodes, continuous force simulation, hover highlights.
 *
 * Why canvas instead of SVG: 3,000+ SVG nodes drops below 30fps; canvas
 * sustains 60fps with hit-testing via linear scan (or quadtree on demand).
 */

export interface ForceGraphProps {
  repoTree: RepoTreeNode;
  touchedFiles: GraphNode[];
  passRateByNode?: Record<string, number>;
  width: number;
  height: number;
  className?: string;
  showTransitionEdges?: boolean;
  transitionEdges?: GraphEdge[];
}

type NodeKind = "dir" | "file";

interface FGNode extends d3.SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  name: string;
  path: string;
  depth: number;
  fileCount: number;
  visits: number;
  passRate?: number;
  radius: number;
  parentId: string | null;
}

interface FGLink extends d3.SimulationLinkDatum<FGNode> {
  source: string | FGNode;
  target: string | FGNode;
  kind: "struct" | "transition";
}

const ROOT_ID = "__root__";

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function passRateFill(rate: number, palette: { success: string; danger: string; mid: string }): string {
  if (rate >= 0.8) return palette.success;
  if (rate <= 0.2) return palette.danger;
  if (rate >= 0.5) {
    const t = (rate - 0.5) / 0.3;
    return d3.interpolateLab(palette.mid, palette.success)(t);
  }
  const t = (0.5 - rate) / 0.3;
  return d3.interpolateLab(palette.mid, palette.danger)(t);
}

function fileNodeRadius(visits: number, touched: boolean): number {
  if (!touched) return 1.4;
  // Touched files start at 12px so they're findable in a sea of 1.4px dots
  // even at the default zoom level. Capped at 24px for the most-visited.
  return Math.min(12 + Math.sqrt(visits) * 2.6, 24);
}

function dirNodeRadius(fileCount: number): number {
  return Math.min(4 + Math.sqrt(fileCount) * 0.9, 11);
}

function buildGraph(
  tree: RepoTreeNode,
  touched: GraphNode[],
  width: number,
  height: number,
): { nodes: FGNode[]; links: FGLink[] } {
  const nodes: FGNode[] = [];
  const links: FGLink[] = [];
  const touchedByPath = new Map<string, GraphNode>();
  for (const t of touched) {
    if (t.target) touchedByPath.set(t.target, t);
  }
  // Precompute "subtree contains a touched file" so we can roll up deep
  // untouched subtrees into a single super-dot. Without this the tests/
  // petal alone bloats to ~2000 nodes and visually overlaps neighbours.
  const ROLLUP_DEPTH = 3;
  const hasTouchedDescendant = (n: RepoTreeNode, currentPath: string): boolean => {
    const path = currentPath ? `${currentPath}/${n.name}` : n.name;
    if (n.kind === "file") return touchedByPath.has(n.path ?? path);
    for (const c of n.children ?? []) {
      if (hasTouchedDescendant(c, path)) return true;
    }
    return false;
  };
  // Seed every node near canvas centre with a small random jitter so the
  // sim doesn't have to migrate ~3000 nodes diagonally from the d3 default
  // phyllotaxis spiral at (0,0). Cuts the "spawn chaos" window from ~1.5s
  // to ~0.3s (per RT1 finding 1+7).
  const cx = width / 2;
  const cy = height / 2;
  const seedX = () => cx + (Math.random() - 0.5) * 60;
  const seedY = () => cy + (Math.random() - 0.5) * 60;
  // Synthetic root anchors everything so the simulation never breaks apart.
  nodes.push({
    id: ROOT_ID,
    kind: "dir",
    name: "repo",
    path: "",
    depth: 0,
    fileCount: tree.totalFiles,
    visits: tree.totalVisits,
    radius: dirNodeRadius(tree.totalFiles) + 2,
    parentId: null,
    x: cx,
    y: cy,
  });
  const walk = (node: RepoTreeNode, parentId: string, currentPath: string, depth: number) => {
    const path = currentPath ? `${currentPath}/${node.name}` : node.name;
    const id = node.kind === "dir" ? `d:${path || ROOT_ID}` : `f:${node.path ?? path}`;
    if (node.kind === "dir") {
      // Roll up: at depth >= ROLLUP_DEPTH with no touched descendants, emit
      // one super-dot sized by file count and stop recursing. Drops node
      // count from ~4086 to ~1500 for pylint-like repos so the depth=1
      // petals don't visually overlap each other.
      if (depth >= ROLLUP_DEPTH && !hasTouchedDescendant(node, currentPath)) {
        const superR = Math.min(3 + Math.sqrt(node.totalFiles) * 1.1, 14);
        nodes.push({
          id: `r:${path}`,
          kind: "dir",
          name: `${node.name}/ (${node.totalFiles})`,
          path,
          depth,
          fileCount: node.totalFiles,
          visits: node.totalVisits,
          radius: superR,
          parentId,
          x: seedX(),
          y: seedY(),
        });
        links.push({ source: parentId, target: `r:${path}`, kind: "struct" });
        return;
      }
      nodes.push({
        id,
        kind: "dir",
        name: node.name || "(root)",
        path,
        depth,
        fileCount: node.totalFiles,
        visits: node.totalVisits,
        radius: dirNodeRadius(node.totalFiles),
        parentId,
        x: seedX(),
        y: seedY(),
      });
      links.push({ source: parentId, target: id, kind: "struct" });
      for (const child of node.children ?? []) {
        walk(child, id, path, depth + 1);
      }
    } else {
      const touched = touchedByPath.get(node.path ?? "");
      const isTouched = !!touched;
      nodes.push({
        id,
        kind: "file",
        name: node.name,
        path: node.path ?? path,
        depth,
        fileCount: 1,
        visits: touched?.visits ?? 0,
        radius: fileNodeRadius(touched?.visits ?? 0, isTouched),
        parentId,
        // Touched files spawn closer to centre with tighter jitter so they
        // are immediately visible at the focal point.
        x: isTouched ? cx + (Math.random() - 0.5) * 30 : seedX(),
        y: isTouched ? cy + (Math.random() - 0.5) * 30 : seedY(),
      });
      links.push({ source: parentId, target: id, kind: "struct" });
    }
  };
  for (const top of tree.children ?? []) {
    walk(top, ROOT_ID, "", 1);
  }
  return { nodes, links };
}

export function ForceGraph({
  repoTree,
  touchedFiles,
  passRateByNode,
  width,
  height,
  className,
  showTransitionEdges = false,
  transitionEdges,
}: ForceGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<d3.Simulation<FGNode, FGLink> | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  // Spatial index over current node positions. Rebuilt on every sim tick.
  // Shared between sim/draw effect and interaction effect via ref.
  const quadtreeRef = useRef<d3.Quadtree<FGNode> | null>(null);
  const hoverRef = useRef<FGNode | null>(null);
  // World-coord cursor while hovering a node. Read by the hover-pull force
  // each tick so the hovered neighbourhood drifts toward the live cursor.
  const hoverCursorRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef<FGNode | null>(null);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const dprRef = useRef(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);

  const palette = useMemo(
    () => ({
      bg: readCssVar("--color-bg-canvas", "#0b0e14"),
      accent: readCssVar("--color-accent-primary", "#38bdf8"),
      dim: readCssVar("--color-text-tertiary", "#6b7280"),
      primary: readCssVar("--color-text-primary", "#e6edf3"),
      success: readCssVar("--color-status-success", "#4ade80"),
      danger: readCssVar("--color-status-danger", "#f87171"),
      edge: readCssVar("--color-border-subtle", "rgba(255,255,255,0.06)"),
      transition: readCssVar("--color-status-info", "#60a5fa"),
    }),
    [],
  );

  const { nodes, links } = useMemo(
    () => buildGraph(repoTree, touchedFiles, width, height),
    [repoTree, touchedFiles, width, height],
  );

  const touchedIdSet = useMemo(
    () => new Set(touchedFiles.filter((t) => t.target).map((t) => `f:${t.target}`)),
    [touchedFiles],
  );

  // Debug shim — expose live references so the test harness can read
  // current sim positions on demand.
  if (typeof window !== "undefined") {
    (window as unknown as { __fgDebug?: unknown }).__fgDebug = {
      touchedIdSet: Array.from(touchedIdSet),
      nodesRef: nodes,
      get touchedNow() {
        return nodes
          .filter((n) => n.kind === "file" && touchedIdSet.has(n.id))
          .map((n) => ({ id: n.id, radius: n.radius, x: n.x, y: n.y, fx: n.fx, fy: n.fy }));
      },
    };
  }

  // Build adjacency for hover highlight. For a file we want "parent dir
  // + siblings sharing that parent" (RT3 finding 3) — strict 1-hop hides
  // siblings which is counter-intuitive. For a dir we want parent + its
  // children.
  const adjacency = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const addEdge = (a: string, b: string) => {
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    };
    // Pass 1: direct parent edges
    for (const link of links) {
      const s = typeof link.source === "string" ? link.source : link.source.id;
      const t = typeof link.target === "string" ? link.target : link.target.id;
      addEdge(s, t);
    }
    // Pass 2: sibling edges — every child of a parent connects to every
    // other child of the same parent. Keeps the hover-set readable when
    // the user looks at a single file inside a populated dir.
    const childrenByParent = new Map<string, string[]>();
    for (const link of links) {
      const s = typeof link.source === "string" ? link.source : link.source.id;
      const t = typeof link.target === "string" ? link.target : link.target.id;
      // Direction in our links is parent → child (struct).
      if (!childrenByParent.has(s)) childrenByParent.set(s, []);
      childrenByParent.get(s)!.push(t);
    }
    for (const [_parent, kids] of childrenByParent) {
      for (let i = 0; i < kids.length; i += 1) {
        for (let j = i + 1; j < kids.length; j += 1) {
          addEdge(kids[i]!, kids[j]!);
        }
      }
    }
    return map;
  }, [links]);

  // Build node lookup for transition edges (touched files reference by their f: id)
  const nodeById = useMemo(() => {
    const m = new Map<string, FGNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Pre-compute fixed radial anchor points for each depth=1 dir. Distributes
  // top-level dirs as a "flower" around the root so each becomes a visibly
  // distinct cluster. These are HARD PINS (fx/fy) applied during sim setup
  // — the depth=1 dirs don't move, so their subtree's children settle
  // around them as petals.
  const radialAnchors = useMemo(() => {
    const dirs = nodes.filter((n) => n.kind === "dir" && n.depth === 1);
    // Sort by fileCount desc so the biggest subtrees get the cardinal positions.
    dirs.sort((a, b) => b.fileCount - a.fileCount);
    const cx = width / 2;
    const cy = height / 2;
    // Radius scales with sqrt(viewport) to leave room for petal contents.
    const r = Math.min(width, height) * 0.28;
    const anchors = new Map<string, { x: number; y: number }>();
    dirs.forEach((d, i) => {
      const angle = (i / dirs.length) * Math.PI * 2 - Math.PI / 2;
      anchors.set(d.id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    });
    return anchors;
  }, [nodes, width, height]);

  // Apply hard pins to depth=1 dirs before the sim starts. fx/fy override
  // all forces — these nodes don't move.
  useMemo(() => {
    for (const n of nodes) {
      if (n.kind === "dir" && n.depth === 1) {
        const anchor = radialAnchors.get(n.id);
        if (anchor) {
          n.x = anchor.x;
          n.y = anchor.y;
          n.fx = anchor.x;
          n.fy = anchor.y;
        }
      }
    }
    return nodes;
  }, [nodes, radialAnchors]);

  // Run simulation
  useEffect(() => {
    if (nodes.length === 0) return;
    const sim = d3
      .forceSimulation<FGNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<FGNode, FGLink>(links.filter((l) => l.kind === "struct"))
          .id((d) => d.id)
          .distance((l) => {
            const s = l.source as FGNode;
            const t = l.target as FGNode;
            // Dir->dir links a bit longer to spread top-level dirs.
            if (s.kind === "dir" && t.kind === "dir") return 60;
            return 22;
          })
          .strength(0.4),
      )
      .force(
        "charge",
        d3
          .forceManyBody<FGNode>()
          // Mild repulsion only — at 3000+ nodes the cumulative repulsion
          // explodes the cloud off-screen if this is too strong.
          .strength((d) => (touchedIdSet.has(d.id) ? -8 : -18))
          .distanceMax(120)
          .theta(0.92),
      )
      // Asymmetric collide — touched files reserve less collision space than
      // their visual radius so the dim cloud doesn't get pushed away from
      // them in an obvious halo gap (RT4 finding 6).
      .force(
        "collide",
        d3.forceCollide<FGNode>((d) =>
          touchedIdSet.has(d.id) ? d.radius * 0.55 + 1.5 : d.radius + 1.5,
        ),
      )
      // Per-parent centring — each non-pinned node pulls toward its parent
      // dir's live position. Depth=1 dirs are PINNED (fx/fy) so their
      // children naturally cluster around the pin. No need for special
      // depth=1 logic here.
      .force(
        "x",
        d3
          .forceX<FGNode>((d) => {
            const parent = d.parentId ? nodeById.get(d.parentId) : null;
            return parent?.x ?? width / 2;
          })
          .strength(0.12),
      )
      .force(
        "y",
        d3
          .forceY<FGNode>((d) => {
            const parent = d.parentId ? nodeById.get(d.parentId) : null;
            return parent?.y ?? height / 2;
          })
          .strength(0.12),
      )
      // Stop the sim when it settles. Hover / drag bumps alphaTarget back
      // up. This is the single biggest perf win at 3k+ nodes — the sim
      // never wastes ticks while idle.
      .alphaMin(0.015)
      .alphaDecay(0.05)
      .velocityDecay(0.5);
    // Hover-pull: gentle drift of hovered node + 1-hop neighbours toward
    // cursor world coords. No-op when hoverRef is null, so cost is ~one
    // null-check per tick when idle. Strength tuned small enough that
    // pinned (fx/fy) nodes are unaffected and the cloud doesn't visibly
    // deform — just "breathes."
    sim.force("hover-pull", (alpha: number) => {
      const h = hoverRef.current;
      const c = hoverCursorRef.current;
      if (!h || !c) return;
      const neighbours = adjacency.get(h.id);
      const k = 0.18 * alpha;
      for (const n of nodes) {
        if (n.fx != null || n.fy != null) continue;
        const isHover = n.id === h.id;
        const isNeighbour = neighbours?.has(n.id);
        if (!isHover && !isNeighbour) continue;
        if (n.x == null || n.y == null || n.vx == null || n.vy == null) continue;
        const pull = isHover ? k : k * 0.45;
        n.vx += (c.x - n.x) * pull;
        n.vy += (c.y - n.y) * pull;
      }
    });
    // Pre-tick the sim before first paint so the cloud spawns settled, not
    // mid-explosion. ~100 silent ticks ≈ 35ms at 3k nodes.
    sim.alpha(0.8);
    for (let i = 0; i < 100; i += 1) sim.tick();
    // Seed the quadtree from pre-ticked positions so the very first
    // mousemove (before tick.draw has fired) already gets O(log n).
    quadtreeRef.current = d3
      .quadtree<FGNode>()
      .x((d) => d.x ?? 0)
      .y((d) => d.y ?? 0)
      .addAll(nodes);
    simRef.current = sim;

    // Compute bbox of all settled node positions and apply a zoom transform
    // that fits the whole graph in the viewport. Without this the user lands
    // at k=1 zoomed into the center, seeing only the central mass — the
    // radial petals are clipped.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x == null || n.y == null) continue;
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    if (isFinite(minX) && isFinite(maxX)) {
      const contentW = (maxX - minX) * 1.12 + 30;
      const contentH = (maxY - minY) * 1.12 + 30;
      const k = Math.min(width / contentW, height / contentH, 1);
      const tx = (width - (minX + maxX) * k) / 2;
      const ty = (height - (minY + maxY) * k) / 2;
      transformRef.current = d3.zoomIdentity.translate(tx, ty).scale(k);
    }
    return () => {
      sim.stop();
    };
  }, [nodes, links, width, height, touchedIdSet, nodeById, radialAnchors, adjacency]);

  // Draw on tick + animation frame
  useEffect(() => {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    if (!canvas || !sim) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = dprRef.current;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    let raf = 0;
    let dirty = true;
    // Mark dirty + rebuild quadtree on every sim tick. Rebuild is O(n log n)
    // (~50k ops at 4k nodes), well below frame budget. Single rebuild per
    // tick is cheaper than incremental updates because positions of ~every
    // node change each tick.
    const drawSim = simRef.current;
    if (drawSim) {
      drawSim.on("tick.draw", () => {
        quadtreeRef.current = d3
          .quadtree<FGNode>()
          .x((d) => d.x ?? 0)
          .y((d) => d.y ?? 0)
          .addAll(nodes);
        dirty = true;
      });
    }
    const draw = () => {
      if (!dirty) {
        raf = requestAnimationFrame(draw);
        return;
      }
      dirty = false;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, width, height);

      const t = transformRef.current;
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      const hover = hoverRef.current;
      const hoverNeighbours = hover ? adjacency.get(hover.id) ?? new Set<string>() : null;
      const dimmed = !!hover;

      // Viewport clip bounds (world coords) — anything outside skips draw.
      const vx0 = (-t.x) / t.k - 30;
      const vy0 = (-t.y) / t.k - 30;
      const vx1 = (width - t.x) / t.k + 30;
      const vy1 = (height - t.y) / t.k + 30;
      const inView = (x: number, y: number) =>
        x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;

      // Edges — skip entirely when zoomed far out (the cloud is the signal).
      if (t.k >= 0.4) {
        ctx.lineWidth = 0.6 / t.k;
        ctx.strokeStyle = palette.edge;
        ctx.beginPath();
        for (const link of links) {
          if (link.kind !== "struct") continue;
          const s = link.source as FGNode;
          const tn = link.target as FGNode;
          if (s.x == null || s.y == null || tn.x == null || tn.y == null) continue;
          if (!inView(s.x, s.y) && !inView(tn.x, tn.y)) continue;
          const inFocus = !dimmed || (hover && (s.id === hover.id || tn.id === hover.id));
          if (dimmed && !inFocus) continue;
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(tn.x, tn.y);
        }
        ctx.stroke();
      }

      // Transition edges (touched-file ordering — optional overlay)
      if (showTransitionEdges && transitionEdges && transitionEdges.length > 0) {
        ctx.lineWidth = 1.2 / t.k;
        ctx.strokeStyle = palette.transition;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        for (const e of transitionEdges) {
          // Transition edges use raw target ids that correspond to file paths
          const sourceNode = nodeById.get(`f:${e.source}`) ?? nodeById.get(e.source);
          const targetNode = nodeById.get(`f:${e.target}`) ?? nodeById.get(e.target);
          if (!sourceNode || !targetNode) continue;
          if (
            sourceNode.x == null ||
            sourceNode.y == null ||
            targetNode.x == null ||
            targetNode.y == null
          )
            continue;
          ctx.moveTo(sourceNode.x, sourceNode.y);
          ctx.lineTo(targetNode.x, targetNode.y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Draw nodes — untouched files first, then dirs, then touched files on top.
      const drawNode = (n: FGNode) => {
        if (n.x == null || n.y == null) return;
        if (!inView(n.x, n.y)) return;
        // Skip nodes whose device-pixel radius < 0.6 px — invisible anyway.
        if (n.radius * t.k < 0.6 && !touchedIdSet.has(n.id)) return;
        const inFocus =
          !dimmed ||
          (hover && (n.id === hover.id || hoverNeighbours?.has(n.id))) ||
          false;
        const alpha = dimmed && !inFocus ? 0.18 : 1;
        const isTouched = touchedIdSet.has(n.id);
        let fill: string;
        if (n.kind === "dir") {
          fill = palette.dim;
        } else if (isTouched) {
          const rate = passRateByNode?.[n.id];
          fill =
            rate != null && Number.isFinite(rate)
              ? passRateFill(rate, { success: palette.success, danger: palette.danger, mid: palette.dim })
              : palette.accent;
        } else {
          fill = palette.dim;
        }
        ctx.globalAlpha = alpha;
        const r = n.radius;
        // Halo for touched files so they pop against the dim file dots.
        if (isTouched) {
          ctx.fillStyle = fill;
          ctx.globalAlpha = alpha * 0.18;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = n.kind === "file" && !isTouched ? alpha * 0.45 : alpha;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (n.kind === "dir") {
          ctx.lineWidth = 1 / t.k;
          ctx.strokeStyle = palette.primary;
          ctx.globalAlpha = alpha * 0.4;
          ctx.stroke();
        } else if (isTouched) {
          ctx.lineWidth = 1.6 / t.k;
          ctx.strokeStyle = palette.primary;
          ctx.globalAlpha = alpha * 0.9;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      };
      // pass 1: untouched files
      for (const n of nodes) {
        if (n.kind === "file" && !touchedIdSet.has(n.id)) drawNode(n);
      }
      // pass 2: dirs
      for (const n of nodes) {
        if (n.kind === "dir") drawNode(n);
      }
      // pass 3: touched files (on top)
      for (const n of nodes) {
        if (n.kind === "file" && touchedIdSet.has(n.id)) drawNode(n);
      }

      // Hover ring
      if (hover && hover.x != null && hover.y != null) {
        ctx.lineWidth = 2 / t.k;
        ctx.strokeStyle = palette.primary;
        ctx.beginPath();
        ctx.arc(hover.x, hover.y, hover.radius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Labels — three tiers, each with its own font-size rule:
      //   touched-file labels: GROW with zoom (the load-bearing things to
      //     find). 12px at k=1 → 16px at k=4+. Bold.
      //   dir labels: hold constant ~11px regardless of zoom.
      //   secondary file labels: only at k ≥ 2, small (8px), dim.
      //
      // All three respect the same dedupe so they don't fight for space —
      // touched draw first (win), dirs second, file labels last.
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";

      type Box = { x0: number; y0: number; x1: number; y1: number };
      const drawnBoxes: Box[] = [];
      const overlaps = (b: Box): boolean => {
        for (const o of drawnBoxes) {
          if (!(b.x1 < o.x0 || b.x0 > o.x1 || b.y1 < o.y0 || b.y0 > o.y1)) return true;
        }
        return false;
      };

      // Draws a label with the given screen-px size + weight; returns true
      // on success, false if it was dropped due to overlap. The breathing
      // padding ensures adjacent labels aren't visually touching.
      const drawLabel = (
        n: FGNode,
        color: string,
        screenPx: number,
        weight: "normal" | "bold",
        breathingPx: number,
      ): boolean => {
        if (n.x == null || n.y == null) return false;
        const text = n.name.slice(0, 22);
        const charW = (screenPx * 0.6) / t.k;
        const charH = (screenPx * 1.2) / t.k;
        const pad = breathingPx / t.k;
        const w = text.length * charW;
        const cx = n.x;
        const cy = n.y - n.radius - charH * 0.4;
        const box: Box = {
          x0: cx - w / 2 - pad,
          y0: cy - charH - pad,
          x1: cx + w / 2 + pad,
          y1: cy + pad,
        };
        if (overlaps(box)) return false;
        ctx.font = `${weight} ${screenPx / t.k}px var(--font-mono, monospace)`;
        // Backing rect — only for touched/dir labels; secondary file labels
        // skip the backing to avoid the "wall of black rectangles" look.
        if (weight === "bold") {
          ctx.fillStyle = palette.bg;
          ctx.globalAlpha = 0.78;
          ctx.fillRect(
            box.x0 + pad - 2 / t.k,
            box.y0 + pad - 1 / t.k,
            (box.x1 - box.x0) - 2 * pad + 4 / t.k,
            (box.y1 - box.y0) - 2 * pad + 2 / t.k,
          );
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = color;
        ctx.fillText(text, cx, n.y - n.radius - 4 / t.k);
        drawnBoxes.push(box);
        return true;
      };

      // PASS A — touched files. Font GROWS with zoom: 12px at k=1, 16px at k≥4.
      // Bold, with backing rect, generous breathing room.
      const touchedPx = Math.min(16, 12 + Math.max(0, t.k - 1) * 1.3);
      for (const n of nodes) {
        if (n.x == null || n.y == null) continue;
        if (!inView(n.x, n.y)) continue;
        if (n.kind !== "file" || !touchedIdSet.has(n.id)) continue;
        const inFocus =
          !dimmed ||
          (hover && (n.id === hover.id || hoverNeighbours?.has(n.id))) ||
          false;
        if (dimmed && !inFocus) continue;
        drawLabel(n, palette.primary, touchedPx, "bold", 5);
      }

      // PASS B — hovered node (always)
      if (hover && hover.x != null) {
        drawLabel(hover, palette.primary, 12, "bold", 5);
      }

      // PASS C — dirs in depth-priority order (depth=1 first, depth=2
      // second). Without this ordering, a packed depth=2 subdir can claim
      // the box that a more-important top-level dir wanted. Steady 11px
      // for depth=1, 10px for depth=2, both bold + backed.
      if (t.k >= 0.5) {
        const depthOneDirs: FGNode[] = [];
        const depthTwoDirs: FGNode[] = [];
        for (const n of nodes) {
          if (n.kind !== "dir") continue;
          if (n.depth === 1) depthOneDirs.push(n);
          else if (n.depth === 2) depthTwoDirs.push(n);
        }
        // Sort each tier by fileCount descending — bigger dirs (more files)
        // get the first shot at label space.
        depthOneDirs.sort((a, b) => b.fileCount - a.fileCount);
        depthTwoDirs.sort((a, b) => b.fileCount - a.fileCount);
        const drawDirTier = (tier: FGNode[], px: number) => {
          for (const n of tier) {
            if (n.x == null || n.y == null) continue;
            if (!inView(n.x, n.y)) continue;
            const inFocus =
              !dimmed ||
              (hover && (n.id === hover.id || hoverNeighbours?.has(n.id))) ||
              false;
            if (dimmed && !inFocus) continue;
            drawLabel(n, palette.primary, px, "bold", 3);
          }
        };
        drawDirTier(depthOneDirs, 11);
        if (t.k >= 0.8) drawDirTier(depthTwoDirs, 10);
      }

      // PASS D — deeper dirs at zoom ≥ 1.2. 9px, normal weight, no backing.
      // Sorted by fileCount desc so bigger subdirs win the dedupe lottery.
      if (t.k >= 1.2) {
        const deepDirs: FGNode[] = [];
        for (const n of nodes) {
          if (n.kind === "dir" && n.depth > 2) deepDirs.push(n);
        }
        deepDirs.sort((a, b) => b.fileCount - a.fileCount);
        let dirBudget = 80;
        for (const n of deepDirs) {
          if (dirBudget <= 0) break;
          if (n.x == null || n.y == null) continue;
          if (!inView(n.x, n.y)) continue;
          const inFocus =
            !dimmed ||
            (hover && (n.id === hover.id || hoverNeighbours?.has(n.id))) ||
            false;
          if (dimmed && !inFocus) continue;
          if (drawLabel(n, palette.dim, 9, "normal", 2)) dirBudget -= 1;
        }
      }

      // PASS E — untouched file labels at very deep zoom (k ≥ 2.4).
      // 8px, dim, no backing, tight budget. Sparser at lower zoom so we
      // never get a wall of overlapping file names.
      if (t.k >= 2.4) {
        let fileBudget = Math.round(20 + (t.k - 2.4) * 30);
        for (const n of nodes) {
          if (fileBudget <= 0) break;
          if (n.x == null || n.y == null) continue;
          if (!inView(n.x, n.y)) continue;
          if (n.kind !== "file" || touchedIdSet.has(n.id)) continue;
          const inFocus =
            !dimmed ||
            (hover && (n.id === hover.id || hoverNeighbours?.has(n.id))) ||
            false;
          if (dimmed && !inFocus) continue;
          if (drawLabel(n, palette.dim, 8, "normal", 1)) fileBudget -= 1;
        }
      }

      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // Expose a "redraw on hover/transform change" hook via the canvas itself
    // so the interaction effect can mark dirty without re-running this effect.
    (canvas as unknown as { __markDirty?: () => void }).__markDirty = () => {
      dirty = true;
    };

    return () => {
      cancelAnimationFrame(raf);
      if (drawSim) drawSim.on("tick.draw", null);
    };
  }, [
    nodes,
    links,
    width,
    height,
    palette,
    touchedIdSet,
    passRateByNode,
    adjacency,
    showTransitionEdges,
    transitionEdges,
    nodeById,
  ]);

  // Zoom + drag + hover wiring
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sel = d3.select(canvas);

    // Maximum possible hit radius across all nodes, in world units. Used as
    // the quadtree.find() search envelope — per-node hitR is verified after
    // the candidate comes back. Floor at 16 to cover the zoom-out Fitts case.
    let maxRadius = 0;
    for (const n of nodes) if (n.radius > maxRadius) maxRadius = n.radius;
    const maxHitR = Math.max(maxRadius + 3, 16);

    const findNodeAt = (clientX: number, clientY: number): FGNode | null => {
      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const sx = (localX - t.x) / t.k;
      const sy = (localY - t.y) / t.k;
      const qt = quadtreeRef.current;
      if (!qt) return null;
      // Search the quadtree with the global max hit radius, then verify the
      // candidate against its own Fitts-aware per-node hitR — preserves the
      // existing semantics exactly while dropping the lookup from O(n) linear
      // scan to O(log n) tree walk (~340x speedup at 4k nodes).
      const candidate = qt.find(sx, sy, maxHitR);
      if (!candidate || candidate.x == null || candidate.y == null) return null;
      const dx = candidate.x - sx;
      const dy = candidate.y - sy;
      const d2 = dx * dx + dy * dy;
      const hitR = Math.max(candidate.radius + 3, 8 / Math.max(t.k, 0.5));
      return d2 < hitR * hitR ? candidate : null;
    };

    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 8])
      .filter((event: Event) => {
        // Block zoom entirely while drag is active — prevents the
        // one-frame snap glitch when wheel-zooming mid-drag (RT4 finding 2).
        if (draggingRef.current) return false;
        // Don't pan when starting drag on a node
        if (event.type === "mousedown") {
          const me = event as MouseEvent;
          return !findNodeAt(me.clientX, me.clientY);
        }
        return !(event as MouseEvent).button;
      })
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        (canvas as unknown as { __markDirty?: () => void }).__markDirty?.();
      });

    const drag = d3
      .drag<HTMLCanvasElement, unknown>()
      .filter((event: Event) => event.type === "mousedown" && !(event as MouseEvent).button)
      .subject((event: { sourceEvent: MouseEvent }) => {
        const target = findNodeAt(event.sourceEvent.clientX, event.sourceEvent.clientY);
        return target ?? null;
      })
      .on("start", (event) => {
        if (!event.subject) return;
        draggingRef.current = event.subject as FGNode;
        simRef.current?.alphaTarget(0.3).restart();
        (event.subject as FGNode).fx = (event.subject as FGNode).x;
        (event.subject as FGNode).fy = (event.subject as FGNode).y;
      })
      .on("drag", (event) => {
        if (!event.subject) return;
        const t = transformRef.current;
        const rect = canvas.getBoundingClientRect();
        const localX = event.sourceEvent.clientX - rect.left;
        const localY = event.sourceEvent.clientY - rect.top;
        const sx = (localX - t.x) / t.k;
        const sy = (localY - t.y) / t.k;
        (event.subject as FGNode).fx = sx;
        (event.subject as FGNode).fy = sy;
        // Drag pointer can move faster than sim ticks. Mark dirty so the
        // next rAF redraw shows the node at the cursor even between ticks
        // (RT2 finding 5).
        (canvas as unknown as { __markDirty?: () => void }).__markDirty?.();
      })
      .on("end", (event) => {
        if (!event.subject) return;
        simRef.current?.alphaTarget(0);
        draggingRef.current = null;
        // Keep node pinned where the user dropped it. Double-click releases.
      });

    sel.call(zoom).call(drag);
    // Seed d3.zoom with the initial fit transform computed by the draw
    // effect. Without this, the first wheel event would reset to identity.
    sel.call(zoom.transform, transformRef.current);

    const onMove = (ev: MouseEvent) => {
      const target = findNodeAt(ev.clientX, ev.clientY);
      const prev = hoverRef.current;
      // Update cursor world coords every move while hovering, so the
      // hover-pull force reads fresh coords each tick.
      if (target) {
        const rect = canvas.getBoundingClientRect();
        const t = transformRef.current;
        hoverCursorRef.current = {
          x: (ev.clientX - rect.left - t.x) / t.k,
          y: (ev.clientY - rect.top - t.y) / t.k,
        };
      } else {
        hoverCursorRef.current = null;
      }
      if (target?.id !== prev?.id) {
        hoverRef.current = target;
        setHoverLabel(target ? `${target.path || target.name} · ${target.kind === "file" ? (touchedIdSet.has(target.id) ? `${target.visits}v` : "untouched") : `${target.fileCount}f`}` : null);
        (canvas as unknown as { __markDirty?: () => void }).__markDirty?.();
        // Hover-enter: wake the sim gently. Hover-exit: release back to 0
        // so the sim drifts under alphaMin and re-freezes within ~1s.
        if (target && !draggingRef.current) {
          simRef.current?.alphaTarget(0.04).restart();
        } else if (!target) {
          simRef.current?.alphaTarget(0);
        }
      }
      canvas.style.cursor = target ? "pointer" : "grab";
    };
    const onDoubleClick = (ev: MouseEvent) => {
      const target = findNodeAt(ev.clientX, ev.clientY);
      if (target) {
        (target as FGNode).fx = null;
        (target as FGNode).fy = null;
        simRef.current?.alpha(0.3).restart();
      }
    };
    const onLeave = () => {
      if (hoverRef.current) {
        hoverRef.current = null;
        hoverCursorRef.current = null;
        setHoverLabel(null);
        (canvas as unknown as { __markDirty?: () => void }).__markDirty?.();
      }
      simRef.current?.alphaTarget(0);
      canvas.style.cursor = "grab";
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("dblclick", onDoubleClick);
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("dblclick", onDoubleClick);
      sel.on(".zoom", null).on(".drag", null);
    };
  }, [nodes, touchedIdSet]);

  return (
    <div className={clsx("relative", className)} style={{ width, height }}>
      <canvas
        ref={canvasRef}
        className="block cursor-grab"
        aria-label={`Repository force graph: ${nodes.length} nodes`}
      />
      {hoverLabel ? (
        <div
          className="absolute top-2 left-2 px-2 py-1 rounded-sm font-mono text-xs text-text-primary bg-bg-canvas/85 border border-border-hairline pointer-events-none"
          style={{ maxWidth: width - 16 }}
        >
          {hoverLabel}
        </div>
      ) : null}
      <div className="absolute bottom-2 right-2 px-2 py-1 rounded-sm font-mono text-[10px] text-text-tertiary bg-bg-canvas/70 pointer-events-none">
        drag bg = pan · wheel = zoom · drag node = pin · dbl-click = release
      </div>
    </div>
  );
}
