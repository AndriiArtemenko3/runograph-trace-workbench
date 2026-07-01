import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import clsx from "clsx";
import type { GraphNode, GraphEdge, RepoTreeNode } from "../../api/routes";
import { LegendInline } from "./ConformanceGraph/LegendInline";
import { ContextMenuPopover } from "./ConformanceGraph/ContextMenuPopover";
import { NodeMark } from "./ConformanceGraph/NodeMark";
import { Inspector } from "./ConformanceGraph/Inspector";
import { DrillBreadcrumb } from "./ConformanceGraph/DrillBreadcrumb";
import { LAYOUT, THEME, TOP_N_DISTRICTS } from "./ConformanceGraph/_layout";
import {
  shortLabel,
  toHierarchy,
  classifyEdge,
  strokeFor,
  Z_ORDER,
  emptyIncident,
  type HierItem,
  type EdgeClass,
  type IncidentCounts,
} from "./ConformanceGraph/_classify";
import { useDebouncedValue } from "./useDebouncedValue";

/**
 * Mode E — Conformance Differential.
 *
 * Reuses the Mode A substrate logic (treemap layout over repoTree) and
 * overlays directly-follows edges classified by run-outcome:
 *
 *   pass-only  (passCount > 0, failCount == 0)  — solid green
 *   fail-only  (failCount > 0, passCount == 0)  — dashed red
 *   shared     (both > 0)                       — solid grey
 *
 * Answers "where did failed runs diverge from passing ones?" at a glance.
 * Files whose incident edges include BOTH pass-only and fail-only are
 * marked as divergence points with a dashed violet ring (fork-out, fork-in,
 * and pass-through divergence are all captured).
 *
 * The substrate is rendered without heat fill (just district outlines +
 * labels), keeping the canvas legible while the edge-classification colors
 * carry the conformance signal. The treemap layout itself is identical to
 * TreemapBackdrop so spatial memory transfers across modes.
 */

export interface ConformanceGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  repoTree: RepoTreeNode;
  width: number;
  height: number;
  className?: string;
}

// Mode E palette + integers + LAYOUT canon now live in `./ConformanceGraph/_layout.ts`
// (sibling-only single source of truth, also consumed by Inspector / NodeMark /
// DrillBreadcrumb / ContextMenuPopover). The local short-names below are pure
// aliases — they exist only so the ~15 downstream usage sites in this file stay
// readable without `THEME.` prefixing. Edits to the literals go in _layout.ts.
const { violet: VIOLET, passGreen: PASS_GREEN, failRed: FAIL_RED, sharedGrey: SHARED_GREY } = THEME;

export function ConformanceGraph({
  nodes,
  edges,
  repoTree,
  width,
  height,
  className,
}: ConformanceGraphProps) {
  const [hoverEdge, setHoverEdge] = useState<GraphEdge | null>(null);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [kbFocusEdge, setKbFocusEdge] = useState<GraphEdge | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [showActions, setShowActions] = useState<boolean>(false);
  const [ctxMenu, setCtxMenu] = useState<
    | { x: number; y: number; target: { kind: "node" | "edge"; id: string } }
    | null
  >(null);
  const [kbFocusNode, setKbFocusNode] = useState<string | null>(null);
  // Drill-in stack — Shneiderman-style multi-level drill. Each Cmd-click /
  // 'd' push appends a frame; Escape pops one; substrate / × / Fit /
  // dblclick clear all. `focusNodeId` is the derived stack leaf so every
  // downstream useEffect dep stays unchanged.
  const [drillStack, setDrillStack] = useState<string[]>([]);
  const focusNodeId = drillStack[drillStack.length - 1] ?? null;
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  // Inner <g> ref — d3.zoom writes transform directly to the DOM here
  // to avoid a full React re-render of the substrate per wheel tick.
  const gRef = useRef<SVGGElement>(null);
  // Latest transform (mirror of d3.zoom state) — written every tick.
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const rafPendingRef = useRef<number | null>(null);
  // True while the d3.zoom useEffect's instance is mounted; rAF callback
  // checks this before calling setTransform to avoid post-cleanup setState.
  const mountedRef = useRef<boolean>(true);
  // Mirror refs for the global keydown handler so it can stay bound once
  // ([] deps) without going stale on every selection / drill toggle.
  const ctxMenuRef = useRef<typeof ctxMenu>(null);
  const focusNodeIdRef = useRef<string | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  // Live-closure helpers for enterDrill / runProgrammaticZoom /
  // computeDrillTransform are function declarations inside the component
  // body — they re-bind each render and read render-local state. Mirror
  // them through refs so the nodeMarkHandlers memo deps stay [] (keeps
  // NodeMark.memo identity hot) and the global keydown effect (also []-
  // deps) reads latest values at call time. Same pattern as ctxMenuRef
  // / focusNodeIdRef / selectedNodeRef. Initialized to a no-op then re-
  // bound by useEffect after each render — refs are non-null by contract.
  const enterDrillRef = useRef<(id: string) => void>(() => {});
  const runProgrammaticZoomRef = useRef<(t: d3.ZoomTransform, dur?: number) => void>(() => {});
  const computeDrillTransformRef = useRef<(id: string) => d3.ZoomTransform | null>(() => null);
  // Same mirror pattern for the three drill-pop helpers — popDrillFrame /
  // popToDepth / exitDrill close over `drillStack` lexically and are called
  // from the []-deps global keydown listener below. Without these refs the
  // listener reads first-render drillStack=[] forever, collapsing the stack
  // in one Escape. Re-bound every render by the sync useEffects relocated
  // below computeDrillTransform's declaration. Closes V12 P8 regression.
  const popDrillFrameRef = useRef<(duration?: number) => void>(() => {});
  const popToDepthRef = useRef<(depth: number, duration?: number) => void>(() => {});
  const exitDrillRef = useRef<(duration?: number) => void>(() => {});
  // Live mirror of drillStack so the mid-drill auto-exit branch reads the
  // latest stack inside an effect whose deps deliberately exclude drillStack
  // (adding it would re-fire on every setDrillStack and risk an oscillation
  // when validStack content matches but the array identity differs). Same
  // mirror pattern as the trio above.
  const drillStackRef = useRef<string[]>([]);
  // Tracks last-applied drill focus so the drill-mode useEffect can
  // distinguish focus-change (animate) from layout-reflow re-fires (snap),
  // and so the substrate (no-focus) branch fires only on an actual exit.
  const prevFocusRef = useRef<string | null>(null);
  // Override the drill-mode useEffect's default 450ms exit duration on the
  // next null-focus transition. Set by resetView / dblclick exit paths so
  // "Fit while drilled" honors the 250ms reset rhythm.
  const resetDurationRef = useRef<number | null>(null);
  // True during programmatic zoom transitions (resetView / dblclick / drill).
  // Consumers gating on transform changes can read this to skip feedback loops.
  const programmaticZoomRef = useRef<boolean>(false);
  // Drill-transition refs (perf F1). opacity is written DIRECTLY to four
  // parent <g> siblings (bright/dimmed × edges/nodes) so the 450ms ease
  // doesn't commit React per frame.
  const drillProgressRef = useRef<number>(1);
  const drillBrightEdgesGRef = useRef<SVGGElement | null>(null);
  const drillDimmedEdgesGRef = useRef<SVGGElement | null>(null);
  const drillBrightNodesGRef = useRef<SVGGElement | null>(null);
  const drillDimmedNodesGRef = useRef<SVGGElement | null>(null);
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);

  // Honor prefers-reduced-motion — collapses drill + reset transitions to
  // 0ms for users with vestibular sensitivity (WCAG 2.3.3). Subscribes to
  // media-query changes so a mid-session toggle of macOS Reduce-motion
  // takes effect without a reload.
  const [reduceMotion, setReduceMotion] = useState<boolean>(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (ev: MediaQueryListEvent) => setReduceMotion(ev.matches);
    // Safari < 14 exposes addListener/removeListener instead of add/removeEventListener.
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  // Mirror reduceMotion into a ref so runProgrammaticZoom (called from
  // closures captured during the first render of the d3.zoom useEffect)
  // always reads the latest value.
  const reduceMotionRef = useRef(reduceMotion);
  useEffect(() => { reduceMotionRef.current = reduceMotion; }, [reduceMotion]);

  // d3.zoom — wheel zoom + drag pan. Scale clamped [0.5, 8]. The actual
  // transform is applied to the inner <g> below so chrome (legend,
  // inspector) stays anchored to canvas corners.
  useEffect(() => {
    if (!svgRef.current) return;
    mountedRef.current = true;
    const svg = d3.select<SVGSVGElement, unknown>(svgRef.current);
    // Guard against page-scroll fallthrough when the wheel fires over the
    // canvas. React's synthetic wheel is passive by default — must attach
    // a non-passive native listener so preventDefault() is honored. Gate
    // on ctrl/meta so bare wheel falls through to page scroll (Mapbox /
    // Google Maps idiom) and the canvas only zooms on modifier+wheel.
    const svgEl = svgRef.current;
    const wheelGuard = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    svgEl.addEventListener("wheel", wheelGuard, { passive: false });
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 8])
      // Drop secondary-button (right-click) and middle-button events so the
      // context-menu gesture isn't swallowed by d3.zoom's pan filter.
      // Wheel requires ctrl/meta to engage zoom — bare wheel scrolls page.
      .filter((event) => {
        if (event.type === "wheel") return event.ctrlKey || event.metaKey;
        return !event.button;
      })
      .on("start", (event) => {
        if (event.sourceEvent?.type === "mousedown") setIsPanning(true);
      })
      .on("end", () => setIsPanning(false))
      .on("zoom", (event) => {
        // Hot path: write transform to DOM directly. No React commit on the
        // substrate / edges / nodes per wheel tick.
        transformRef.current = event.transform;
        if (gRef.current) {
          gRef.current.setAttribute("transform", event.transform.toString());
        }
        // rAF-coalesced setState so the leader-line (which reads transform
        // in JSX) updates at most once per frame. Skip during programmatic
        // zoom — the .on("end") handler will land the final value.
        if (programmaticZoomRef.current) return;
        if (rafPendingRef.current != null) return;
        rafPendingRef.current = requestAnimationFrame(() => {
          if (!mountedRef.current) return;
          setTransform(transformRef.current);
          rafPendingRef.current = null;
        });
      });
    zoomRef.current = zoom;
    svg.call(zoom);
    // Repurpose dblclick: reset to identity instead of d3's default zoom-in,
    // which conflicts with rapid click-on-node interactions. React onClick on
    // the substrate is the SINGLE OWNER of dblclick → resetView.
    svg.on("dblclick.zoom", null);
    // Cleanup
    return () => {
      mountedRef.current = false;
      svg.on(".zoom", null);
      svgEl.removeEventListener("wheel", wheelGuard);
      if (rafPendingRef.current != null) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }
    };
  }, []);

  const runProgrammaticZoom = useCallback((target: d3.ZoomTransform, duration: number = LAYOUT.zoomDuration.reset) => {
    if (!svgRef.current || !zoomRef.current) return;
    programmaticZoomRef.current = true;
    d3.select(svgRef.current)
      .transition()
      .duration(reduceMotionRef.current ? 0 : duration)
      .ease(d3.easeCubicInOut)
      .call(zoomRef.current.transform, target)
      .on("end interrupt cancel", () => {
        programmaticZoomRef.current = false;
        // Land the final transform once so the leader-line (which reads React
        // `transform` state) re-syncs after the gesture-coalesced setState
        // was suppressed during the transition. Mid-transition unmount
        // (REPO VIEW chip change) can fire this callback after teardown —
        // mountedRef guard prevents the post-unmount setState warning.
        if (mountedRef.current && transformRef.current) {
          setTransform(transformRef.current);
        }
      });
  }, []);

  const resetView = () => {
    // Atomic substrate restore. When drilled, delegate to exitDrill so the
    // drill-exit policy (selection / kbFocus / edge clear + reset duration)
    // lives in one place. When already on substrate, clear any pinned
    // selection and run the direct identity transition.
    if (focusNodeIdRef.current) {
      exitDrill(LAYOUT.zoomDuration.reset, "mouse");
      return;
    }
    setSelectedNode(null);
    setKbFocusNode(null);
    setSelectedEdge(null);
    runProgrammaticZoom(d3.zoomIdentity, LAYOUT.zoomDuration.reset);
  };

  // Memoised so ContextMenuPopover's React.memo comparator + outside-click
  // useEffect don't churn on every parent commit while the menu is open.
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // Keyboard a11y: Escape closes layers in priority order — context menu,
  // then drill-mode focus, then pinned selection.
  // Tab to focus svg + each hit ring (tabIndex on circles); Enter/Space on
  // a focused hit ring toggles selection. Arrow-key spatial nav deferred.
  useEffect(() => { ctxMenuRef.current = ctxMenu; }, [ctxMenu]);
  useEffect(() => { focusNodeIdRef.current = focusNodeId; }, [focusNodeId]);
  useEffect(() => { selectedNodeRef.current = selectedNode; }, [selectedNode]);
  // Sync effects for enterDrill / runProgrammaticZoom / computeDrillTransform
  // are relocated to just after their declarations (post-L1134) so their
  // identity deps resolve without TDZ. Search for the matching block below.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (ctxMenuRef.current) {
          setCtxMenu(null);
          e.preventDefault();
          return;
        }
        if (focusNodeIdRef.current) {
          // Escape pops ONE drill frame so multi-level drills walk back
          // step-by-step (substrate / × / Fit clear the whole stack).
          // Route through the ref mirror so this []-deps listener reads
          // the freshest popDrillFrame closure (live drillStack), not the
          // mount-time empty stack. Closes V12 P8 regression.
          popDrillFrameRef.current();
          e.preventDefault();
          return;
        }
        if (selectedNodeRef.current) {
          setSelectedNode(null);
          setKbFocusNode(null);
          e.preventDefault();
        }
      }
      if ((e.key === "r" || e.key === "R") && focusNodeIdRef.current) {
        // Re-anchor the drill transform — works any time the user is
        // drilled, regardless of which node currently has Tab focus.
        // Camera verb, not a per-node verb. Refs (kept current by sync
        // effects above) keep this []-deps listener reading the LATEST
        // drill bounds even after prop updates shift node positions.
        e.preventDefault();
        const t = computeDrillTransformRef.current(focusNodeIdRef.current);
        if (t) runProgrammaticZoomRef.current(t, LAYOUT.zoomDuration.drill);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Treemap layout over the full repo, sized to the SUBSTRATE area only
  // (height minus actions-strip reserve). drawHeight is computed below;
  // referenced here via closure but defined before this useMemo's invocation
  // semantically — React hooks execute top-to-bottom each render, so we
  // compute drawHeight inline first.
  const ACTIONS_STRIP_HEIGHT = showActions ? LAYOUT.actionsStripHeightOpen : 0;
  const drawHeight = Math.max(120, height - ACTIONS_STRIP_HEIGHT);

  // Top-N district rollup. The Figma canon assumes ~6 named districts;
  // raw repos hand us 8+ including tiny dirs that produce slivers and
  // substrate noise. Keep the top-5 by totalFiles, force-preserve any
  // district that has touched files (carries pass/fail signal), and roll
  // the remainder into an "…other" tile summing the dropped totals.
  const filteredRepoTree = useMemo<RepoTreeNode>(() => {
    if (!repoTree.children || repoTree.children.length <= TOP_N_DISTRICTS + 1) {
      return repoTree;
    }
    // District prefixes that any edge REFERENCES — these are preserved even
    // if their file-event visit counts are zero, because Mode E exists to
    // show edge structure not file activity. Convention: preservation is
    // based on raw edge references, not on whether the edge survives
    // placedEdges filtering — a district with a referenced-but-dropped
    // edge still pins open so users can inspect its files manually.
    const edgeIncidentPrefixes = new Set<string>();
    for (const e of edges) {
      for (const id of [e.source, e.target]) {
        const slash = id.indexOf("/");
        if (slash > 0) edgeIncidentPrefixes.add(id.slice(0, slash));
      }
    }
    const sized = repoTree.children.map((c) => ({
      node: c,
      files: c.kind === "dir" ? c.totalFiles : 1,
      visits: c.kind === "dir" ? c.totalVisits : c.visits,
    }));
    const sortedDesc = [...sized].sort((a, b) => b.visits - a.visits || b.files - a.files);
    const topSlice = sortedDesc.slice(0, TOP_N_DISTRICTS);
    const restSlice = sortedDesc.slice(TOP_N_DISTRICTS);
    // Preserve any rest-district that has touched files — never hide signal.
    const preservedFromRest = restSlice.filter(
      (x) => x.visits > 0 || edgeIncidentPrefixes.has(x.node.name),
    );
    const droppedToOther = restSlice.filter(
      (x) => x.visits === 0 && !edgeIncidentPrefixes.has(x.node.name),
    );
    const kept: RepoTreeNode[] = [
      ...topSlice.map((x) => x.node),
      ...preservedFromRest.map((x) => x.node),
    ];
    if (droppedToOther.length) {
      const rollupFiles = droppedToOther.reduce((s, x) => s + x.files, 0);
      const rollupVisits = droppedToOther.reduce((s, x) => s + x.visits, 0);
      const rollupSize = droppedToOther.reduce(
        (s, x) => s + (x.node.kind === "dir" ? x.node.totalSize : (x.node.size ?? 0)),
        0,
      );
      kept.push({
        name: `…other (${droppedToOther.length})`,
        kind: "dir",
        path: "__rollup_other",
        visits: 0, // synthetic — no direct events here; recursive sum lives in totalVisits
        // Synthetic file leaves: one per dropped district, weight = that
        // district's recursive visit sum. Without leaf children the
        // `.sum()` accessor below (leaves only) resolves the rollup to
        // zero area and the tile renders invisibly. Path prefix
        // `__rollup_` keeps these out of `fileCenters` (real file paths
        // never start with `__`).
        children: droppedToOther.map((x) => ({
          name: `__rollup_${x.node.name}`,
          kind: "file" as const,
          path: `__rollup_${x.node.name}`,
          visits: x.visits,
          size: x.node.kind === "dir" ? x.node.totalSize : (x.node.size ?? 0),
          totalFiles: 1,
          totalSize: x.node.kind === "dir" ? x.node.totalSize : (x.node.size ?? 0),
          totalVisits: x.visits,
        })),
        totalFiles: rollupFiles,
        totalSize: rollupSize,
        totalVisits: rollupVisits, // recursive sum across dropped subtree
      });
    }
    return { ...repoTree, children: kept };
  }, [repoTree, edges]);

  // Resize debounce — at carryover scale (2000+ files) unconditional
  // per-tick layout recompute eats 90-150ms of jank during window resize.
  // 100ms debounce collapses a 500ms drag into ~5 layout passes instead of
  // ~30. Substrate visibly rubber-bands during the drag (live transform is
  // independent via gRef setAttribute) and snaps on release.
  const debouncedSize = useDebouncedValue({ width, drawHeight }, 100);
  const layout = useMemo(() => {
    const hier = d3
      .hierarchy<HierItem>(toHierarchy(filteredRepoTree), (d) => d.children)
      // Visit-weighted with a small file-count floor. Visits dominate
      // where they exist (the conformance signal) but a per-file floor
      // (0.1) keeps non-visit districts visible. The 5x visit multiplier
      // ensures touched-file weight (5+ per visit) outweighs the floor
      // (0.1 per untouched file) at any realistic scale, so visit-heavy
      // districts still expand. Pure visit-weighting collapses
      // untouched districts to width 0; pure file-count gave tests/
      // ~50% dominance (the iter-0 surface bug). This blend preserves
      // both signals.
      .sum((d) => (d.kind === "file" ? (d.visits ?? 0) * 5 + 0.1 : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const tm = d3
      .treemap<HierItem>()
      .size([debouncedSize.width, debouncedSize.drawHeight])
      .padding(2)
      .paddingOuter(4)
      .round(true);
    return tm(hier);
  }, [filteredRepoTree, debouncedSize.width, debouncedSize.drawHeight]);

  // Build file path -> {cx, cy} map from the treemap leaves.
  const fileCenters = useMemo(() => {
    const m = new Map<string, { cx: number; cy: number }>();
    const dupes: string[] = [];
    layout.eachAfter((n) => {
      if (n.data.kind === "file" && n.data.path) {
        if (m.has(n.data.path)) dupes.push(n.data.path);
        m.set(n.data.path, {
          cx: (n.x0 + n.x1) / 2,
          cy: (n.y0 + n.y1) / 2,
        });
      }
    });
    if (dupes.length && import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("ConformanceGraph: duplicate file paths in treemap", dupes);
    }
    return m;
  }, [layout]);

  // Position EVERY node in the aggregate graph:
  //  - file nodes go at their treemap-tile center
  //  - non-file nodes (tool/action — bash invocations etc.) get placed in
  //    an "actions strip" along the bottom of the canvas, sorted by visit
  //    count so the busiest tool sits leftmost
  // Without this, ~80% of edges drop because most agent activity is
  // tool→file or file→tool, not file→file.

  // Node-by-id lookup. Replaces O(N) `nodes.find(...)` scans (one of which
  // fires inside the per-node render loop — formerly O(N²)).
  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    const dupes: string[] = [];
    for (const n of nodes) {
      if (m.has(n.id)) dupes.push(n.id);
      m.set(n.id, n);
    }
    if (dupes.length && import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("ConformanceGraph: duplicate node ids in nodes[]", dupes);
    }
    return m;
  }, [nodes]);

  const nodePositions = useMemo(() => {
    const m = new Map<string, { cx: number; cy: number; nodeId: string; kind: GraphNode["kind"] }>();

    // Files placed at treemap tile centers
    const droppedFileNodes: Array<{ id: string; target: string }> = [];
    for (const n of nodes) {
      if (n.kind === "file" && n.target) {
        const pos = fileCenters.get(n.target);
        if (pos) m.set(n.id, { cx: pos.cx, cy: pos.cy, nodeId: n.id, kind: "file" });
        else droppedFileNodes.push({ id: n.id, target: n.target });
      }
    }
    if (droppedFileNodes.length) {
      // Dataset drift surface — file node referenced by graph but absent
      // from treemap (top-N rollup or path-normalization mismatch). Gated
      // to dev so production users don't see internal diagnostics.
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn("ConformanceGraph: dropped file nodes (no treemap tile)", droppedFileNodes);
      }
    }

    // Action / tool nodes laid out in a horizontal strip at the bottom.
    // Gated on showActions; default off matches the Figma canon.
    // Capped at LAYOUT.maxActionNodes so stride stays above the hit-rect
    // width and labels stay legible at high tool-node counts. Tool/action
    // ids that any edge references are preserved past the cap so no edge
    // silently drops just because its endpoint is a low-visit tool node.
    const edgeIncidentNonFileIds = new Set<string>();
    for (const e of edges) {
      const sn = nodeById.get(e.source);
      const tn = nodeById.get(e.target);
      if (sn && sn.kind !== "file") edgeIncidentNonFileIds.add(sn.id);
      if (tn && tn.kind !== "file") edgeIncidentNonFileIds.add(tn.id);
    }
    const actionNodes = showActions
      ? (() => {
          const sorted = nodes.filter((n) => n.kind !== "file").sort((a, b) => b.visits - a.visits);
          const top = sorted.slice(0, LAYOUT.maxActionNodes);
          const inTop = new Set(top.map((n) => n.id));
          const preserved = sorted
            .slice(LAYOUT.maxActionNodes)
            .filter((n) => edgeIncidentNonFileIds.has(n.id) && !inTop.has(n.id));
          return [...top, ...preserved];
        })()
      : [];
    if (actionNodes.length && showActions) {
      const stripY = drawHeight + ACTIONS_STRIP_HEIGHT / 2;
      const margin = LAYOUT.geom.stripMargin;
      const stride = (width - 2 * margin) / Math.max(actionNodes.length, 1);
      actionNodes.forEach((n, i) => {
        m.set(n.id, {
          cx: margin + stride * (i + 0.5),
          cy: stripY,
          nodeId: n.id,
          kind: n.kind,
        });
      });
    }
    return m;
  }, [nodes, edges, fileCenters, drawHeight, width, showActions]);

  // Entries view of nodePositions — sorted by (cy, cx) so Tab order through
  // the rendered SVG follows top-down / left-right visual reading order
  // (a11y-F8). Materialised once per Map identity so the JSX render doesn't
  // re-allocate the tuple array per commit (performance-F5).
  const nodePositionsList = useMemo(
    () =>
      Array.from(nodePositions.entries()).sort(
        ([, a], [, b]) => (a.cy - b.cy) || (a.cx - b.cx),
      ),
    [nodePositions],
  );

  // Viewport-culling threshold — below this node count, the React reconciler
  // cost of committing all elements is cheaper than the per-render filter
  // scan. At carryover scale (>500) culling earns its keep. See iter-6 perf F2.
  const VIEWPORT_CULL_THRESHOLD = 500;
  const cullEnabled = nodePositionsList.length > VIEWPORT_CULL_THRESHOLD;
  // Stale-pad cache for visibleBbox — re-cull fires only when the camera
  // moves >100px from the cached pad envelope. The bbox returned to
  // downstream useMemos already includes the STALE_PAD as part of the
  // visible window so partially-visible nodes inside the pad band stay
  // mounted across small pans without a re-filter pass.
  const lastBboxRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number; tk: number; tx: number; ty: number } | null>(null);
  const visibleBbox = useMemo(() => {
    if (!cullEnabled) return null;
    const lb = lastBboxRef.current;
    const STALE_PAD = 100;
    if (lb && Math.abs(lb.tk - transform.k) < 0.01 && Math.abs(lb.tx - transform.x) < STALE_PAD && Math.abs(lb.ty - transform.y) < STALE_PAD) {
      return { minX: lb.minX, minY: lb.minY, maxX: lb.maxX, maxY: lb.maxY };
    }
    // Pad by one node radius so partially-visible nodes at the edge don't
    // pop in/out during pan. STALE_PAD extends the cached window so small
    // pans inside the pad band reuse the cached bbox.
    const pad = 24;
    const tl = transform.invert([0 - pad - STALE_PAD, 0 - pad - STALE_PAD]);
    const br = transform.invert([width + pad + STALE_PAD, height + pad + STALE_PAD]);
    const bbox = { minX: tl[0], minY: tl[1], maxX: br[0], maxY: br[1] };
    lastBboxRef.current = { ...bbox, tk: transform.k, tx: transform.x, ty: transform.y };
    return bbox;
  }, [cullEnabled, transform, width, height]);
  const visibleNodesList = useMemo(() => {
    if (!cullEnabled) return nodePositionsList;
    if (!visibleBbox) return nodePositionsList;
    const { minX, minY, maxX, maxY } = visibleBbox;
    return nodePositionsList.filter(
      ([, p]) => p.cx >= minX && p.cx <= maxX && p.cy >= minY && p.cy <= maxY,
    );
  }, [cullEnabled, nodePositionsList, visibleBbox]);

  // Count of total action/tool nodes — independent of the showActions
  // flag so the chip can advertise what would appear if toggled on.
  const actionNodeCount = useMemo(
    () => nodes.filter((n) => n.kind !== "file").length,
    [nodes],
  );

  // Center pull for HEB-style bundling — anchored to the SUBSTRATE area
  // (not full canvas) so corridors curve through the treemap, not down
  // into the actions strip. Hoisted above placedEdges so the path-string
  // cache (perf F5) can reference these during the useMemo build.
  const centerPullCx = width / 2;
  const centerPullCy = drawHeight / 2;

  // Pure helper: builds the SVG `d` string for a corridor. Hoisted above
  // placedEdges to support the per-edge `d` cache. Self-loops render as a
  // small arc above the node; non-self-loops use HEB-style center-pull cubic.
  const buildCorridorPath = useCallback(
    (sx: number, sy: number, tx: number, ty: number, selfLoop: boolean): string => {
      if (selfLoop) {
        const r = LAYOUT.geom.selfLoopR;
        const yAnchor = sy + LAYOUT.geom.selfLoopYAnchor;
        const ax = sx - r * LAYOUT.geom.selfLoopInsetFactor;
        const ay = yAnchor;
        const bx = sx + r * LAYOUT.geom.selfLoopInsetFactor;
        const by = yAnchor;
        return `M ${ax} ${ay} A ${r} ${r} 0 1 1 ${bx} ${by}`;
      }
      const mx = (sx + tx) / 2;
      const my = (sy + ty) / 2;
      const ctlX = mx + LAYOUT.geom.centerPull * (centerPullCx - mx);
      const ctlY = my + LAYOUT.geom.centerPull * (centerPullCy - my);
      return `M ${sx} ${sy} C ${ctlX} ${ctlY} ${ctlX} ${ctlY} ${tx} ${ty}`;
    },
    [centerPullCx, centerPullCy],
  );

  // Filter edges to those whose both endpoints have a position. Classify
  // + sort by z-order. Self-loops are kept (rendered as small arc above
  // the node rather than a degenerate center-pull bezier). Caches the
  // `d` string per edge so render commits don't rebuild it (perf F5).
  const placedEdges = useMemo(() => {
    const items: Array<{
      edge: GraphEdge;
      cls: EdgeClass;
      sx: number;
      sy: number;
      tx: number;
      ty: number;
      selfLoop: boolean;
      d: string;
    }> = [];
    for (const e of edges) {
      const s = nodePositions.get(e.source);
      const t = nodePositions.get(e.target);
      if (!s || !t) continue;
      // Endpoint Y must match the RENDERED dot position (which applies
      // actionLabelOffsetY to non-file nodes at the node-mark layer), not
      // the layout Y — otherwise self-loop arcs and corridors anchor below
      // the dot.
      const sy = s.kind === "file" ? s.cy : s.cy + LAYOUT.actionLabelOffsetY;
      const ty = t.kind === "file" ? t.cy : t.cy + LAYOUT.actionLabelOffsetY;
      const selfLoop = e.source === e.target;
      items.push({
        edge: e,
        cls: classifyEdge(e),
        sx: s.cx,
        sy,
        tx: t.cx,
        ty,
        selfLoop,
        d: buildCorridorPath(s.cx, sy, t.cx, ty, selfLoop),
      });
    }
    items.sort((a, b) => Z_ORDER[a.cls] - Z_ORDER[b.cls]);
    return items;
  }, [edges, nodePositions, buildCorridorPath]);

  // Visible edges — when cullEnabled, drop edges whose endpoint bbox lies
  // entirely outside the visible bbox. Bezier control point pulls toward
  // canvas centre so straight-line bbox is a safe over-approximation.
  const visibleEdgesList = useMemo(() => {
    if (!cullEnabled) return placedEdges;
    if (!visibleBbox) return placedEdges;
    const { minX, minY, maxX, maxY } = visibleBbox;
    return placedEdges.filter((p) => {
      const eMinX = Math.min(p.sx, p.tx);
      const eMaxX = Math.max(p.sx, p.tx);
      const eMinY = Math.min(p.sy, p.ty);
      const eMaxY = Math.max(p.sy, p.ty);
      return eMaxX >= minX && eMinX <= maxX && eMaxY >= minY && eMinY <= maxY;
    });
  }, [cullEnabled, placedEdges, visibleBbox]);

  // Counts by class for the legend.
  const counts = useMemo(() => {
    const c = { "pass-only": 0, "fail-only": 0, shared: 0, untracked: 0 };
    for (const p of placedEdges) c[p.cls] += 1;
    return c;
  }, [placedEdges]);

  // Edge-hidden count for the chrome-strip "+K hidden by tool toggle"
  // surface. When `showActions=false` (default), every tool↔file edge
  // is filtered out of `placedEdges` at the endpoint-resolution step.
  // Without this surface the legend silently shifts totals when the
  // toggle flips.
  const hiddenEdgeCount = edges.length - placedEdges.length;

  // O(1) edge lookup by "source->target" key — mirrors the nodeById Map
  // on the edge side. Used by the ContextMenuPopover onAction handler so
  // a pin-against-edge action doesn't linear-scan placedEdges.
  const edgeByKey = useMemo(() => {
    const m = new Map<string, { edge: GraphEdge }>();
    const dupes: string[] = [];
    for (const p of placedEdges) {
      const k = `${p.edge.source}->${p.edge.target}`;
      if (m.has(k)) dupes.push(k);
      m.set(k, p);
    }
    if (dupes.length && import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn("ConformanceGraph: duplicate edgeByKey collisions (source/target uniqueness violated)", dupes);
    }
    return m;
  }, [placedEdges]);

  // Stable onAction prop — wraps the closure in useCallback so the
  // popover doesn't see a fresh function identity every parent render.
  const onCtxAction = useCallback(
    (action: string, t: { kind: "node" | "edge"; id: string }) => {
      if (t.kind === "node" && action === "pin") {
        setSelectedNode(t.id);
      } else if (t.kind === "edge" && action === "pin") {
        const found = edgeByKey.get(t.id);
        if (found) setSelectedEdge(found.edge);
      }
    },
    [edgeByKey],
  );

  // Divergence points: nodes incident to BOTH at least one pass-only AND at
  // least one fail-only edge. Shared-edge incidence alone is NOT divergence
  // (mixed traffic through one corridor is not a fork — see the intersection
  // step below). Captures fork-out, fork-in, and pass-through divergence.
  // The user-facing "DIVERGENCE NODE" copy carries no OUTGOING qualifier,
  // so both topologies are surfaced.
  const divergenceNodeIds = useMemo(() => {
    const passOnlyByNode = new Set<string>();
    const failOnlyByNode = new Set<string>();
    for (const p of placedEdges) {
      if (p.cls === "pass-only") {
        passOnlyByNode.add(p.edge.source);
        passOnlyByNode.add(p.edge.target);
      }
      if (p.cls === "fail-only") {
        failOnlyByNode.add(p.edge.source);
        failOnlyByNode.add(p.edge.target);
      }
    }
    // Intersection: a node that is incident to both at least one pass-only
    // edge and at least one fail-only edge, regardless of source/target
    // orientation. Captures fork-out, fork-in, and pass-through divergence.
    // Shared-edge endpoints are NOT divergence by themselves (mixed traffic
    // through one corridor is not a fork) — dropped from the union.
    const divergent = [...passOnlyByNode].filter((id) => failOnlyByNode.has(id));
    return new Set(divergent);
  }, [placedEdges]);

  // Per-node incident-edge counts by class. Built once per placedEdges
  // change so the inspector can render in O(1) per hover instead of
  // O(|placedEdges|) per frame.
  // Self-loops contribute 2 to a node's degree per graph-theoretic
  // convention (the edge is simultaneously outgoing and incoming).
  // Don't short-circuit the dedup branch — let both endpoints fire.
  const incidentByNode = useMemo(() => {
    const m = new Map<string, IncidentCounts>();
    for (const p of placedEdges) {
      const selfLoop = p.edge.source === p.edge.target;
      // Self-loop: only iterate once for per-class buckets (one visible
      // corridor = one increment). Headline `count` still gets +2 below
      // to preserve graph-theoretic degree.
      const ids = selfLoop ? [p.edge.source] : [p.edge.source, p.edge.target];
      for (const id of ids) {
        let e = m.get(id);
        if (!e) { e = emptyIncident(); m.set(id, e); }
        e[p.cls] += 1;
        e.count += selfLoop ? 2 : 1;
      }
    }
    return m;
  }, [placedEdges]);

  // Raw incident counts (over `edges`, ignoring showActions gating). Used
  // by the inspector to surface "+K hidden by tool-toggle" when the
  // user's view is hiding part of a node's neighbourhood. Self-loops
  // contribute 2 to match incidentByNode above.
  const rawIncidentCountByNode = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) {
      // Ghost-edge guard: an edge whose endpoint id isn't in `nodeById`
      // can never be pinned, so counting it inflates the symmetric
      // endpoint's "+K not currently rendered" badge with hidden edges
      // that have no resolvable partner. Mirror the placedEdges filter
      // upstream so raw counts stay grounded.
      if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
      const ids = [e.source, e.target];
      for (const id of ids) {
        m.set(id, (m.get(id) ?? 0) + 1);
      }
    }
    return m;
  }, [edges, nodeById]);

  function edgeWidth(count: number): number {
    return Math.max(1.5, Math.min(9, Math.sqrt(count) * 0.95));
  }

  // When a node is selected, only its incident edges stay vivid; others
  // dim. Hovered-node uses the same logic non-stickily.
  const focusedNodeId = selectedNode ?? hoverNode;
  const edgeIsFocused = (e: GraphEdge): boolean => {
    if (!focusedNodeId) return true;
    return e.source === focusedNodeId || e.target === focusedNodeId;
  };

  // Leader-line target — anchor on hovered edge midpoint OR focused node.
  // Card-end is computed in render via inverse-transform so it tracks the
  // fixed card corner regardless of pan/zoom.
  // The heuristic INSPECTOR_ANCHOR was removed in iter-4 axis-2 F2; the
  // leader-render gate now waits for measuredAnchor to land (≤1 frame
  // defer) rather than painting a stale-coordinate flash.
  const inspectorTargetText = useMemo<string>(() => {
    if (hoverEdge) return `${hoverEdge.source}\n${hoverEdge.target}`;
    const focusId = hoverNode ?? kbFocusNode ?? selectedNode;
    if (!focusId) return "";
    const n = nodeById.get(focusId);
    return n?.target || focusId;
  }, [hoverEdge, hoverNode, kbFocusNode, selectedNode, nodeById]);
  // Measured anchor — overrides the heuristic once the inspector card has
  // mounted. Reads the card's bottom-right corner in SVG-local coords so the
  // leader line ends precisely at the card edge across browser zoom, font
  // fallback, and divergence-row variants. Falls back to INSPECTOR_ANCHOR
  // before first paint.
  const inspectorRef = useRef<HTMLDivElement | null>(null);
  const [measuredAnchor, setMeasuredAnchor] = useState<{ x: number; y: number } | null>(null);
  // Legend pack height is data-dependent (3 rows when untracked === 0, 4 rows
  // when present) — measure on mount/unmount/swap via a ref-callback so the
  // empty-state card below can anchor to clear the real rendered height
  // instead of a magic offset. ResizeObserver attached for font-load + zoom
  // re-measures. Fallback 110 covers first-paint before measurement lands.
  const [legendHeight, setLegendHeight] = useState<number>(110);
  const legendRoRef = useRef<ResizeObserver | null>(null);
  const legendRefCallback = useCallback((node: HTMLDivElement | null) => {
    if (legendRoRef.current) {
      legendRoRef.current.disconnect();
      legendRoRef.current = null;
    }
    if (node) {
      setLegendHeight(node.offsetHeight);
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => {
          setLegendHeight(node.offsetHeight);
        });
        ro.observe(node);
        legendRoRef.current = ro;
      }
    }
  }, []);
  useLayoutEffect(() => {
    const el = inspectorRef.current;
    const svg = svgRef.current;
    if (!el || !svg) { setMeasuredAnchor(null); return; }
    // rAF-coalesce the bbox reads so rapid hover transitions + ResizeObserver
    // fires batch into one getBoundingClientRect call per frame. At 1000+
    // SVG children each rect read costs 1-5ms.
    let rafId = 0;
    const measure = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const r = el.getBoundingClientRect();
        const s = svg.getBoundingClientRect();
        // Inspector is right-docked — anchor on the LEFT edge midpoint so the
        // leader exits into canvas, not from the outer corner.
        setMeasuredAnchor({ x: r.left - s.left, y: r.top - s.top + r.height / 2 });
      });
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => {
        ro.disconnect();
        if (rafId) cancelAnimationFrame(rafId);
      };
    }
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [hoverEdge, hoverNode, kbFocusNode, selectedNode, inspectorTargetText]);
  const leaderTarget = useMemo<{ x: number; y: number } | null>(() => {
    const edge = hoverEdge ?? kbFocusEdge;
    if (edge) {
      const s = nodePositions.get(edge.source);
      const t = nodePositions.get(edge.target);
      if (!s || !t) return null;
      return { x: (s.cx + t.cx) / 2, y: (s.cy + t.cy) / 2 };
    }
    const focusId = hoverNode ?? kbFocusNode ?? selectedNode;
    if (!focusId) return null;
    const pos = nodePositions.get(focusId);
    if (!pos) return null;
    return { x: pos.cx, y: pos.cy };
  }, [hoverEdge, kbFocusEdge, hoverNode, kbFocusNode, selectedNode, nodePositions]);

  // Empty state: fires when there is no fail-only divergence to inspect.
  // Shared edges are the agreed-on backbone, not divergence — they shouldn't
  // suppress the empty-state chip.
  const isEmptyConformance = counts["fail-only"] === 0;
  // Sub-state discriminators for the empty chip — predicate above is
  // unchanged; copy below picks the matching headline.
  const noEdgesPlaced = placedEdges.length === 0;
  const untrackedOnly = !noEdgesPlaced && counts["pass-only"] === 0 && counts.shared === 0 && counts.untracked > 0;
  // Shared-only: every edge carries both pass AND fail traffic; no
  // pass-only or untracked edges present. Branch separately from
  // "Clean conformance" so the chip prose doesn't lie about pass-only.
  const sharedOnly = !noEdgesPlaced && counts["pass-only"] === 0 && counts.untracked === 0 && counts.shared > 0;

  // Drill-mode neighborhood: 1-hop nodes from focusNodeId (inclusive).
  // O(|edges|) per focus change. Derived from raw `edges` (not placedEdges)
  // so toggling showActions while drilled doesn't silently redefine the
  // 1-hop semantic set — render-time filtering still hides tool nodes,
  // but the drill scope stays stable. Stable key enables O(1) membership-
  // equality check in the drill effect.
  type KeyedSet = Set<string> & { key: string };
  // Per-node adjacency map — built once per `edges` change. Each drill
  // focus-change reads O(1) instead of re-scanning all edges.
  const neighborTable = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [edges]);
  const drillNeighborhood = useMemo(() => {
    if (!focusNodeId) return null;
    const set = new Set<string>([focusNodeId, ...(neighborTable.get(focusNodeId) ?? [])]);
    (set as KeyedSet).key = [...set].sort().join("|");
    return set as KeyedSet;
  }, [focusNodeId, neighborTable]);

  // Damped drill neighbourhood transition — interpolates opacity over the
  // 450ms drill duration so re-drill A→B doesn't snap nodes/edges between
  // 100% and 8% mid-pan. Snaps instantly under prefers-reduced-motion.
  // perf F1: drillProgress lives in a REF (not state) so the rAF tick
  // doesn't commit React per frame. Four sibling <g> groups receive direct
  // DOM setAttribute("opacity", ...) calls; per-edge / per-node opacity reads
  // collapse to per-group membership decisions.
  const prevNeighborhoodRef = useRef<Set<string> | null>(null);
  const writeDrillOpacity = (p: number) => {
    const dimMin = LAYOUT.opacity.nodeDrillDimmed;
    const dimOp = String(1 - p * (1 - dimMin));
    const brOp = String(p);
    drillBrightEdgesGRef.current?.setAttribute("opacity", brOp);
    drillDimmedEdgesGRef.current?.setAttribute("opacity", dimOp);
    drillBrightNodesGRef.current?.setAttribute("opacity", brOp);
    drillDimmedNodesGRef.current?.setAttribute("opacity", dimOp);
  };
  useEffect(() => {
    if (reduceMotion) {
      drillProgressRef.current = 1;
      writeDrillOpacity(1);
      prevNeighborhoodRef.current = drillNeighborhood;
      return;
    }
    const prev = prevNeighborhoodRef.current as KeyedSet | null;
    const sameMembers =
      prev != null &&
      drillNeighborhood != null &&
      prev.key === drillNeighborhood.key;
    if (sameMembers) {
      prevNeighborhoodRef.current = drillNeighborhood;
      drillProgressRef.current = 1;
      writeDrillOpacity(1);
      return;
    }
    drillProgressRef.current = 0;
    writeDrillOpacity(0);
    const start = performance.now();
    const dur = LAYOUT.zoomDuration.drill;
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled || !mountedRef.current) return;
      const t = Math.min(1, (performance.now() - start) / dur);
      const p = d3.easeCubicInOut(t);
      drillProgressRef.current = p;
      writeDrillOpacity(p);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevNeighborhoodRef.current = drillNeighborhood;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
    };
    // writeDrillOpacity is a stable closure over four refs; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId, reduceMotion, drillNeighborhood]);

  // Programmatic pan-zoom onto focusNodeId. Re-uses the existing d3.zoom
  // instance via zoomRef so user wheel/pan state stays coherent across
  // drill exits. Combines:
  //  - resetDurationRef override (Fit-while-drilled honors 250ms reset)
  //  - prevFocusRef focus-change vs reflow gate (resize / showActions
  //    toggle under stable focus → snap; real focus change → animate)
  //  - substrate stable identity guard (skip identity transition on
  //    initial mount or reflow when no drill is active)
  //  - neighborhood-aware bbox fit (tool-node drills don't strand
  //    substrate off-viewport)
  //  - auto-exit when focused node disappears from nodePositions
  //  - near-identical target skip (live-data jitter doesn't re-animate)
  useEffect(() => {
    if (!svgRef.current || !zoomRef.current) return;
    const prev = prevFocusRef.current;
    if (!focusNodeId) {
      // Substrate (no drill). Only fire the identity transition on a real
      // focused → null exit; skip initial mount and reflow re-fires.
      prevFocusRef.current = null;
      if (prev == null) return;
      const dur = resetDurationRef.current ?? LAYOUT.zoomDuration.drill;
      resetDurationRef.current = null;
      runProgrammaticZoom(d3.zoomIdentity, dur);
      return;
    }
    // Bbox-fit + neighborhood-aware + clamped — delegated to the shared
    // computeDrillTransform helper so the math has a single source of
    // truth (drill entry, R-key re-anchor, future pop-to-depth re-fit).
    // null return = drilled node disappeared (e.g. showActions toggled
    // off while drilled on a tool node) → auto-exit so the user isn't
    // stranded with a frozen 2.5x transform.
    const t = computeDrillTransform(focusNodeId);
    if (!t) {
      // Filter the stack to surviving frames instead of nuking the whole
      // stack. Preserves depth-1..N-1 history when the leaf disappears
      // mid-drill (e.g. showActions toggled off while drilled on a tool node).
      const validStack = drillStackRef.current.filter((id) => nodePositions.has(id));
      const newLeaf = validStack[validStack.length - 1] ?? null;
      if (newLeaf === null) {
        exitDrill();
      } else {
        resetDurationRef.current = LAYOUT.zoomDuration.reset;
        setDrillStack(validStack);
        setSelectedNode(newLeaf);
        setKbFocusNode(newLeaf);
        rehomeDrillFocus(newLeaf);
      }
      return;
    }
    // Skip re-animation if the new target matches the current transform
    // within a 4px / scale-1e-3 tolerance — guards against jank when
    // repoTree / edges props update while drilled in.
    const cur = transformRef.current;
    if (cur && Math.abs(cur.x - t.x) < 4 && Math.abs(cur.y - t.y) < 4 && Math.abs(cur.k - t.k) < 1e-3) {
      prevFocusRef.current = focusNodeId;
      return;
    }
    // Focus-change → animate; layout-reflow re-fire under stable focus → snap.
    const focusChanged = focusNodeId !== prev;
    prevFocusRef.current = focusNodeId;
    runProgrammaticZoom(t, focusChanged ? LAYOUT.zoomDuration.drill : 0);
    // exitDrill / rehomeDrillFocus / computeDrillTransform / runProgrammaticZoom
    // are all useCallback-stable (deps `[rehomeDrillFocus]` / `[]` / layout
    // primitives / `[]`) and declared lower in the file — including them in
    // the dep array would trigger TS2448 use-before-decl. The effect re-fires
    // on the substrate deps below, which already covers every meaningful
    // re-anchor case. Honest single-disable here is cheaper than relocating
    // the 50-line effect below the four declarations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId, nodePositions, width, height, drillNeighborhood]);

  // Symmetric to the drill-mode auto-exit above: clear hover/kb-focus when
  // the underlying node disappears from the layout so stale state doesn't
  // strand on toggle-off → toggle-on (showActions, filteredRepoTree change).
  useEffect(() => {
    if (kbFocusNode && !nodePositions.has(kbFocusNode)) setKbFocusNode(null);
    if (hoverNode && !nodePositions.has(hoverNode)) setHoverNode(null);
    if (selectedNode && !nodePositions.has(selectedNode)) setSelectedNode(null);
  }, [kbFocusNode, hoverNode, selectedNode, nodePositions]);

  // Per-frame label array. DrillBreadcrumb maps over this to render the
  // full chain; clicking frame i pops back to depth i+1.
  const drillChain = useMemo(() => {
    return drillStack.map((id) => {
      const n = nodeById.get(id);
      const label = n?.kind === "file" ? (n.target ?? id) : shortLabel(id, n?.kind);
      return { nodeId: id, label };
    });
  }, [drillStack, nodeById]);

  // Drill-entry helper. Two call sites (mouse click + keyboard 'd'/'D') used
  // to duplicate this gate inline — collapsed to one source of truth so
  // future gate changes (e.g. "skip drill on self-loop-only nodes") land in
  // a single place.
  const enterDrill = useCallback((nodeId: string) => {
    // Read raw edges (not placedEdges-derived incidentByNode) so a file
    // node whose only neighbours are tool nodes still drills under
    // showActions=false — drillNeighborhood will populate from edges.
    const hasNeighbors = edges.some((e) => e.source === nodeId || e.target === nodeId);
    if (hasNeighbors) {
      // Idempotent push: re-drilling the current leaf is a no-op so a
      // double Cmd-click doesn't fill the stack with duplicates.
      setDrillStack((s) => (s[s.length - 1] === nodeId ? s : [...s, nodeId]));
      setSelectedNode(nodeId);
      setSelectedEdge(null);
    } else {
      // Isolated nodes: no drill camera move, toggle pinning instead so
      // the mouse + keyboard surfaces stay consistent. Snapshot-then-set:
      // avoids setState-in-updater anti-pattern (StrictMode-safe).
      const next = selectedNode === nodeId ? null : nodeId;
      setSelectedNode(next);
      if (next === null) setKbFocusNode(null);
      setSelectedEdge(null);
    }
  }, [edges, selectedNode]);

  // Land DOM focus on the post-pop target (ring for a leaf, svg root for
  // substrate) on the next commit so the keyboard-nav chain doesn't strand
  // on document.body after Escape / × / Fit / breadcrumb pop. Same shape as
  // the ArrowKey bounce + NodeMark click rehome already in the file — pop/
  // exit just didn't carry the focus contract through. useCallback with
  // []-deps so the three drill-verb wraps below take it as a stable dep
  // (only reads svgRef.current which is identity-stable forever).
  // Mouse-driven exits (resetView / bg-dblclick / breadcrumb × / breadcrumb
  // popTo) pass source="mouse" so DOM focus stays on the trigger button —
  // restoring focus to the canvas would paint an unsolicited focus ring on
  // the SVG and break native click-then-Tab chrome resumption.
  const rehomeDrillFocus = useCallback((targetId: string | null, source: "keyboard" | "mouse" = "keyboard") => {
    if (source === "mouse") return;
    requestAnimationFrame(() => {
      if (!svgRef.current) return;
      if (targetId) {
        const el = svgRef.current.querySelector<SVGCircleElement>(
          `[data-node-id="${CSS.escape(targetId)}"]`,
        );
        (el ?? svgRef.current).focus({ preventScroll: true });
      } else {
        svgRef.current.focus({ preventScroll: true });
      }
    });
  }, []);

  // Drill-exit helper. Writes resetDurationRef BEFORE clearing focus so the
  // drill-mode useEffect picks up the override (default = 250ms reset
  // rhythm). Without this, every exit surface that forgot the ref drifted
  // back to the 450ms drill duration. Single source of truth for "exit
  // drill at rhythm X". useCallback gives a stable identity contract so
  // the L1218-area mirror-ref useEffect takes an honest [exitDrill] dep —
  // closes the V9 eslint-disable rotation cleanly.
  const exitDrill = useCallback((duration: number = LAYOUT.zoomDuration.reset, source: "keyboard" | "mouse" = "keyboard") => {
    resetDurationRef.current = duration;
    setDrillStack([]);
    setSelectedNode(null);
    setKbFocusNode(null);
    setSelectedEdge(null);
    setKbFocusEdge(null);
    rehomeDrillFocus(null, source);
  }, [rehomeDrillFocus]);

  // Pop a single drill frame. Substrate-aware: at depth-1 this clears the
  // stack. Used by Escape so multi-level drills walk back step-by-step.
  // Re-pins selectedNode to the new leaf so the inspector tracks the
  // current drill focus (Shneiderman contract). useCallback([drillStack])
  // — identity flips on every drill push/pop, which is exactly the cadence
  // the mirror-ref useEffect needs to re-bind.
  const popDrillFrame = useCallback((duration: number = LAYOUT.zoomDuration.reset) => {
    resetDurationRef.current = duration;
    // Compute `next` outside the updater so StrictMode double-invocation
    // doesn't fire setSelectedNode/setKbFocusNode twice — same shape as
    // popToDepth. Preserves the kb-focus anchor on the new leaf so
    // ArrowKey spatial-nav resumes after Escape.
    const next = drillStack.slice(0, -1);
    const newLeaf = next[next.length - 1] ?? null;
    setDrillStack(next);
    setSelectedNode(newLeaf);
    setKbFocusNode(newLeaf);
    setSelectedEdge(null);
    setKbFocusEdge(null);
    rehomeDrillFocus(newLeaf);
  }, [drillStack, rehomeDrillFocus]);

  // Pop the drill stack to a specific depth (used by mid-frame breadcrumb
  // buttons). depth=0 keeps frame 0 only; depth=chain.length-1 is a no-op.
  const popToDepth = useCallback((depth: number, duration: number = LAYOUT.zoomDuration.reset, source: "keyboard" | "mouse" = "keyboard") => {
    resetDurationRef.current = duration;
    // Compute `next` outside the updater so the setSelectedNode side effect
    // sees a deterministic snapshot; under StrictMode the updater can run
    // twice but the side effect now fires exactly once with the correct leaf.
    const next = drillStack.slice(0, Math.max(0, depth + 1));
    const newLeaf = next[next.length - 1] ?? null;
    setDrillStack(next);
    setSelectedNode(newLeaf);
    setKbFocusNode(newLeaf);
    setSelectedEdge(null);
    setKbFocusEdge(null);
    rehomeDrillFocus(newLeaf, source);
  }, [drillStack, rehomeDrillFocus]);

  // NodeMark handler bundle — memoised so the React.memo comparator in
  // NodeMark actually fires across renders. Forwards through refs synced
  // every render so the []-deps bundle still reads live state at call
  // time (edges, nodePositions, drillNeighborhood, width, height).
  const nodeMarkHandlers = useMemo(
    () => ({
      onSetHover: setHoverNode,
      onSetSelected: setSelectedNode,
      onSetKbFocus: setKbFocusNode,
      onSetCtxMenu: setCtxMenu,
      onEnterDrill: (id: string) => enterDrillRef.current(id),
    }),
    [],
  );

  // Shared bbox→transform for the drill viewport. Used by the R-key
  // re-anchor path so it converges on the same camera the initial drill
  // useEffect lands at (bbox-fit + neighborhood-aware + clamped).
  const computeDrillTransform = useCallback((nodeId: string): d3.ZoomTransform | null => {
    const focusPos = nodePositions.get(nodeId);
    if (!focusPos) return null;
    const pts: Array<{ cx: number; cy: number }> = [focusPos];
    if (drillNeighborhood) {
      for (const id of drillNeighborhood) {
        if (id === nodeId) continue;
        const p = nodePositions.get(id);
        if (p) pts.push({ cx: p.cx, cy: p.cy });
      }
    }
    // Single-pass bounds — avoids argument-spread call-stack ceiling on
    // large drill neighborhoods (hub files reaching every district).
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.cx < minX) minX = p.cx;
      if (p.cx > maxX) maxX = p.cx;
      if (p.cy < minY) minY = p.cy;
      if (p.cy > maxY) maxY = p.cy;
    }
    const cx2 = (minX + maxX) / 2;
    const cy2 = (minY + maxY) / 2;
    const bbW = Math.max(maxX - minX, LAYOUT.geom.drillBboxFloor);
    const bbH = Math.max(maxY - minY, LAYOUT.geom.drillBboxFloor);
    const k = Math.min(LAYOUT.drillScale, (width * 0.7) / bbW, (height * 0.7) / bbH);
    return d3.zoomIdentity.translate(width / 2 - cx2 * k, height / 2 - cy2 * k).scale(k);
  }, [nodePositions, drillNeighborhood, width, height]);

  // Mirror enterDrill / runProgrammaticZoom / computeDrillTransform onto
  // refs on identity change so the []-deps handler bundle (used by
  // NodeMark) and []-deps global keydown listener read the latest
  // callbacks. Effects fire only when a useCallback dep flips — not every
  // parent render. Relocated below the declarations so the dep refs
  // resolve without TDZ (the V6 F1 carryover from iter-7/iter-8).
  useEffect(() => { enterDrillRef.current = enterDrill; }, [enterDrill]);
  useEffect(() => { runProgrammaticZoomRef.current = runProgrammaticZoom; }, [runProgrammaticZoom]);
  useEffect(() => { computeDrillTransformRef.current = computeDrillTransform; }, [computeDrillTransform]);
  // Sibling mirrors for the three drill-pop helpers. iter-10 axis-9 wrapped
  // popDrillFrame / popToDepth / exitDrill in useCallback so these mirrors
  // take honest deps — identity flips when drillStack mutates (pop verbs)
  // or stays stable forever (exitDrill). The []-deps Escape keydown listener
  // reads .current at fire time, so the freshest binding lands without
  // closure traps. Closes the V12 P8 regression and the V9 eslint-disable
  // rotation in one sweep.
  useEffect(() => { popDrillFrameRef.current = popDrillFrame; }, [popDrillFrame]);
  useEffect(() => { popToDepthRef.current = popToDepth; }, [popToDepth]);
  useEffect(() => { exitDrillRef.current = exitDrill; }, [exitDrill]);
  useEffect(() => { drillStackRef.current = drillStack; }, [drillStack]);

  // Drill bright/dimmed partition — hoisted out of the JSX IIFEs so the
  // four arrays are computed once per [visibleEdgesList, visibleNodesList,
  // drillNeighborhood] change instead of every parent render. Reads
  // prevNeighborhoodRef.current at memo-build time; that ref only mutates
  // inside the drill rAF tick effect which fires AFTER the parent commit
  // that updates drillNeighborhood — so depending on drillNeighborhood as
  // a proxy keeps correctness while avoiding a ref-read-during-render dep.
  const { brightEdges, dimmedEdges, brightNodes, dimmedNodes } = useMemo(() => {
    const prevSet = prevNeighborhoodRef.current;
    const inBright = (p: typeof placedEdges[number]) => {
      const inCur = !drillNeighborhood ||
        (drillNeighborhood.has(p.edge.source) && drillNeighborhood.has(p.edge.target));
      const inPrev = !prevSet ||
        (prevSet.has(p.edge.source) && prevSet.has(p.edge.target));
      return inCur || inPrev;
    };
    const inBrightN = (nodeId: string) => {
      const inCur = !drillNeighborhood || drillNeighborhood.has(nodeId);
      const inPrev = !prevSet || prevSet.has(nodeId);
      return inCur || inPrev;
    };
    const be: typeof placedEdges = [];
    const de: typeof placedEdges = [];
    for (const p of visibleEdgesList) (inBright(p) ? be : de).push(p);
    const bn: typeof nodePositionsList = [];
    const dn: typeof nodePositionsList = [];
    for (const tup of visibleNodesList) (inBrightN(tup[0]) ? bn : dn).push(tup);
    return { brightEdges: be, dimmedEdges: de, brightNodes: bn, dimmedNodes: dn };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEdgesList, visibleNodesList, drillNeighborhood]);

  return (
    <div role="region" aria-label="Conformance differential graph" className={clsx("relative", className)} style={{ width, height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="absolute inset-0"
        tabIndex={0}
        role="application"
        aria-roledescription="Conformance graph"
        aria-label="Agent runs overlaid on repository treemap"
        aria-describedby="conformance-graph-desc"
        aria-keyshortcuts="Escape D R ArrowUp ArrowDown ArrowLeft ArrowRight Shift+F10"
        style={{ cursor: isPanning ? "grabbing" : "grab" }}
        onClick={(ev) => {
          // Click on empty SVG (not a node/edge) — clear selection.
          // Double-click on empty bg: if drilled, exit drill at the 250ms
          // reset rhythm (resetDurationRef tells the drill-mode useEffect);
          // otherwise reset view directly.
          // Single source of truth — replaces the former d3 dblclick handler.
          if (ev.target === ev.currentTarget) {
            if (ev.detail === 2) {
              if (focusNodeId) {
                exitDrill(LAYOUT.zoomDuration.reset, "mouse");
              } else {
                resetView();
              }
            } else if (!focusNodeId) {
              // Only deselect on bg click when NOT drilled — the drill leaf
              // is structurally the pinned thing; bg click cannot detach it
              // without exiting drill.
              setSelectedNode(null);
              setSelectedEdge(null);
            }
          }
        }}
        onKeyDown={(ev) => {
          // Arrow-key recovery: role="application" suppresses AT browse
          // mode, so a user who lands focus on the SVG root (not a
          // hit-test ring) has no way to start spatial nav. Bounce focus
          // to the first node ring so ArrowKey handler takes over.
          if (ev.target === ev.currentTarget && ev.key.startsWith("Arrow")) {
            const first = svgRef.current?.querySelector<SVGCircleElement>("[data-node-id]");
            if (first) { first.focus({ preventScroll: true }); ev.preventDefault(); }
          }
        }}
      >
        <desc id="conformance-graph-desc">Enter or Space pins the focused node or edge. D drills into the focused node. R re-anchors the drill camera. Arrow keys move spatially between visible nodes. Shift+F10 opens actions for the focused item. Escape closes the menu first, then pops one drill frame at a time, then deselects pin. Substrate link or the close button exit drill in one step. Double-click empty canvas resets zoom.</desc>
        {/* Everything zoomable lives inside this transform group. Chrome
            (legend, inspector) sits OUTSIDE the svg as siblings of svg in
            the wrapping div, so it stays anchored to canvas corners. */}
        {/* gRef DOM write is the single source of truth for this zoom group's
            transform — React state drives the leader-line outside this <g>. */}
        <g ref={gRef}>
        {/* District outlines (depth 1 only — top-level dirs). */}
        {layout
          .descendants()
          .filter((n) => n.depth === 1 && n.data.kind === "dir")
          .map((n) => (
            <g key={`dist-${n.data.name}`}>
              <rect
                x={n.x0}
                y={n.y0}
                width={n.x1 - n.x0}
                height={n.y1 - n.y0}
                fill="rgba(252, 252, 253, 1)"
                stroke="rgba(216, 216, 220, 1)"
                strokeWidth={LAYOUT.stroke.districtOutline}
                rx={4}
                pointerEvents="none"
              />
              {/* Suppress labels on sliver tiles that cannot fit them — text
                  otherwise overflows the rect and lands on neighbouring
                  districts. Threshold matches the canon legibility floor. */}
              {(n.x1 - n.x0) >= 80 && (n.y1 - n.y0) >= 20 ? (
                <text
                  x={n.x0 + 8}
                  y={n.y0 + 16}
                  fontSize={LAYOUT.fontSize.districtName}
                  fontWeight={600}
                  fill="rgba(40, 40, 48, 1)"
                  pointerEvents="none"
                >
                  {n.data.name}/
                </text>
              ) : null}
              {(n.x1 - n.x0) >= 80 && (n.y1 - n.y0) >= 36 ? (
                <text
                  x={n.x0 + 8}
                  y={n.y0 + 30}
                  fontSize={LAYOUT.fontSize.districtCount}
                  fill="rgba(120, 120, 128, 1)"
                  pointerEvents="none"
                >
                  {n.data.totalFiles} files{(n.data.visits ?? 0) > 0 ? ` · ${n.data.visits} visits` : ""}
                </text>
              ) : null}
            </g>
          ))}

        {/* Actions-strip background — separates tool/bash nodes from the
            file substrate. Stays visually subtle so corridors carry the
            attention. */}
        {drawHeight < height ? (
          <g>
            <rect
              x={0}
              y={drawHeight}
              width={width}
              height={height - drawHeight}
              fill="rgba(247, 247, 250, 1)"
              stroke="rgba(220, 220, 225, 1)"
              strokeWidth={LAYOUT.stroke.districtOutline}
              pointerEvents="none"
            />
          </g>
        ) : null}

        {/* Corridors — drawn in z-order so fail-only sits on top. Each
            corridor is rendered TWICE: an invisible fat hit-test stroke
            (~16px) for hover detection + the visible thin stroke.
            perf F1: edges split into bright/dimmed parent <g> siblings;
            opacity carried by the parent group via direct DOM
            setAttribute in the drill rAF tick (no per-frame React commit). */}
        {(() => {
          // Per-edge render helper. Returns the inner <g> with hit-test +
          // halo + visible stroke. Static per-edge opacity — drill fade is
          // a parent-<g> attribute. */
          const renderEdge = (p: typeof placedEdges[number], keyPrefix: string) => {
            const stroke = strokeFor(p.cls);
            const w = edgeWidth(p.edge.count);
            const isHover = hoverEdge === p.edge;
            const focused = edgeIsFocused(p.edge);
            const d = p.d;
            const baseOpacity = p.cls === "shared" ? LAYOUT.opacity.edgeBaseShared : LAYOUT.opacity.edgeBaseDiagnostic;
            const opacity = focused ? baseOpacity : LAYOUT.opacity.edgeDimmed;
            return (
              <g key={`${keyPrefix}-${p.edge.source}->${p.edge.target}::${p.cls}`}>
                {/* Hit-test stroke — invisible, ~16px wide, captures hover */}
                <path
                  d={d}
                  stroke="rgba(0,0,0,0.001)"
                  strokeWidth={LAYOUT.stroke.edgeHitTest}
                  strokeLinecap="round"
                  fill="none"
                  style={{ cursor: "pointer" }}
                  tabIndex={0}
                  role="button"
                  aria-pressed={selectedEdge === p.edge}
                  aria-describedby={selectedEdge === p.edge ? "conformance-inspector-summary" : undefined}
                  aria-keyshortcuts="Enter Space Shift+F10"
                  aria-label={(() => {
                    const tx = p.edge.count;
                    if (p.cls === "untracked") {
                      return `untracked edge from ${p.edge.source} to ${p.edge.target}. ${tx} transition${tx === 1 ? "" : "s"}. Run outcomes unavailable for this edge.`;
                    }
                    const runs = (p.edge.passCount ?? 0) + (p.edge.failCount ?? 0);
                    return `${p.cls} edge from ${p.edge.source} to ${p.edge.target}. Traversed by ${runs} run${runs === 1 ? "" : "s"}, ${tx} transition${tx === 1 ? "" : "s"}.`;
                  })()}
                  onMouseEnter={() => setHoverEdge(p.edge)}
                  onMouseLeave={() => setHoverEdge(null)}
                  onFocus={() => setKbFocusEdge(p.edge)}
                  onBlur={() => {
                    setKbFocusEdge((cur) => (cur === p.edge ? null : cur));
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      ev.stopPropagation();
                      setSelectedEdge((cur) => (cur === p.edge ? null : p.edge));
                    }
                    if (ev.key.startsWith("Arrow")) {
                      ev.preventDefault();
                      // Bounce to the edge's target node so spatial nav resumes
                      // from a node anchor instead of escaping the canvas.
                      const el = svgRef.current?.querySelector<SVGCircleElement>(
                        `[data-node-id="${CSS.escape(p.edge.target)}"]`,
                      );
                      el?.focus({ preventScroll: true });
                      return;
                    }
                    if (ev.key === "ContextMenu" || (ev.shiftKey && ev.key === "F10")) {
                      ev.preventDefault();
                      setHoverEdge(p.edge);
                      setKbFocusEdge(p.edge);
                      const svgEl = svgRef.current;
                      if (svgEl) {
                        const t = transformRef.current;
                        const mx = (p.sx + p.tx) / 2;
                        const my = (p.sy + p.ty) / 2;
                        const [tx, ty] = t.apply([mx, my]);
                        const sR = svgEl.getBoundingClientRect();
                        setCtxMenu({ x: sR.left + tx, y: sR.top + ty, target: { kind: "edge", id: `${p.edge.source}->${p.edge.target}` } });
                      }
                    }
                  }}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelectedEdge((cur) => (cur === p.edge ? null : p.edge));
                  }}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    (ev.currentTarget as SVGPathElement).focus({ preventScroll: true });
                    setHoverEdge(p.edge);
                    setCtxMenu({ x: ev.clientX, y: ev.clientY, target: { kind: "edge", id: `${p.edge.source}->${p.edge.target}` } });
                  }}
                />
                {/* Keyboard-focus halo — violet glow under the visible
                    stroke for the focused edge corridor. Renders only when
                    kb focus has explicitly landed on this edge so mouse
                    hover doesn't paint the halo. */}
                {kbFocusEdge === p.edge ? (
                  <path
                    d={d}
                    stroke={VIOLET}
                    strokeWidth={LAYOUT.stroke.kbFocusHalo}
                    strokeOpacity={LAYOUT.opacity.kbFocusHalo}
                    strokeLinecap="round"
                    fill="none"
                    pointerEvents="none"
                  />
                ) : null}
                {/* Visible stroke */}
                <path
                  d={d}
                  stroke={stroke.color}
                  strokeWidth={isHover ? w + LAYOUT.stroke.edgeHover : w}
                  strokeLinecap="round"
                  strokeOpacity={opacity}
                  strokeDasharray={stroke.dashed ? "6 4" : undefined}
                  fill="none"
                  pointerEvents="none"
                />
              </g>
            );
          };
          // brightEdges + dimmedEdges hoisted into useMemo above the JSX
          // return (see partition memo at component-body bottom).
          return (
            <>
              <g ref={drillBrightEdgesGRef} opacity={1}>
                {brightEdges.map((p) => renderEdge(p, "edge"))}
              </g>
              {drillNeighborhood ? (
                // Drilled-out edges keep the visual fade (opacity carried
                // by writeDrillOpacity on the <g>) but stop accepting
                // pointer + keyboard events so the muted backdrop reads
                // as backdrop, not "still fully interactive."
                <g
                  ref={drillDimmedEdgesGRef}
                  opacity={1}
                  pointerEvents="none"
                  aria-hidden="true"
                  {...({ inert: "" })}
                >
                  {dimmedEdges.map((p) => renderEdge(p, "edge-dim"))}
                </g>
              ) : null}
            </>
          );
        })()}

        {/* Node dots — files in violet on the substrate, tool/action
            nodes as smaller open circles in the actions strip. Every node
            has a transparent 14px hit-test ring for reliable hover/click,
            and a "selected" ring when clicked. perf F1: split into
            bright/dimmed parent <g> siblings the same way as edges. */}
        {(() => {
          const renderNode = ([nodeId, pos]: readonly [string, typeof nodePositionsList[number][1]]) => {
            const isFile = pos.kind === "file";
            const fileNode = isFile ? (nodeById.get(nodeId) ?? null) : null;
            const isTouched = (fileNode?.visits ?? 0) > 0 || incidentByNode.has(nodeId);
            return (
              <NodeMark
                key={`node-${nodeId}`}
                nodeId={nodeId}
                pos={pos}
                isHover={hoverNode === nodeId}
                isSelected={selectedNode === nodeId}
                isKbFocused={kbFocusNode === nodeId}
                isDivergence={divergenceNodeIds.has(nodeId)}
                isTouched={isTouched}
                fileNode={fileNode}
                showsRKey={!!focusNodeId}
                nodePositions={nodePositions}
                nodePositionsList={nodePositionsList}
                drillNeighborhood={drillNeighborhood}
                svgRef={svgRef}
                handlers={nodeMarkHandlers}
              />
            );
          };
          // brightNodes + dimmedNodes hoisted into useMemo above the JSX
          // return (see partition memo at component-body bottom).
          return (
            <>
              <g ref={drillBrightNodesGRef} opacity={1}>
                {brightNodes.map(renderNode)}
              </g>
              {drillNeighborhood ? (
                // Mirror the dimmed-edges treatment: visual fade stays,
                // hover-inflate / Tab walk / hit-ring click stop firing.
                <g
                  ref={drillDimmedNodesGRef}
                  opacity={1}
                  pointerEvents="none"
                  aria-hidden="true"
                  {...({ inert: "" })}
                >
                  {dimmedNodes.map(renderNode)}
                </g>
              ) : null}
            </>
          );
        })()}

        </g>
        {/* Inspector leader line — rendered last so it sits above corridors.
            Moved OUTSIDE the zoom transform group so stroke weight and dash
            spacing stay constant in screen space across all zoom levels. The
            leader target (in world coords) is projected to screen via
            transform.apply([x, y]). */}
        {leaderTarget && measuredAnchor ? (() => {
          const [tx, ty] = transform.apply([leaderTarget.x, leaderTarget.y]);
          const anchor = measuredAnchor;
          // Caret tip — small triangle at the ring endpoint, oriented along
          // the leader direction so the line reads as "this points at that
          // ring" rather than "dashed aside." 5px deep, 3px half-width.
          const dx = tx - anchor.x;
          const dy = ty - anchor.y;
          const len = Math.max(Math.hypot(dx, dy), 1);
          const ux = dx / len;
          const uy = dy / len;
          const baseX = tx - ux * LAYOUT.leaderCaret.depthPx;
          const baseY = ty - uy * LAYOUT.leaderCaret.depthPx;
          const px = -uy * LAYOUT.leaderCaret.halfWidthPx;
          const py = ux * LAYOUT.leaderCaret.halfWidthPx;
          return (
            <g pointerEvents="none">
              <line
                x1={anchor.x}
                y1={anchor.y}
                x2={tx}
                y2={ty}
                stroke={VIOLET}
                strokeOpacity={LAYOUT.opacity.leaderLine}
                strokeWidth={LAYOUT.stroke.leaderLine}
              />
              <polygon
                points={`${tx},${ty} ${baseX + px},${baseY + py} ${baseX - px},${baseY - py}`}
                fill={VIOLET}
              />
            </g>
          );
        })() : null}
      </svg>

      {/* Canvas-chrome strip (Mode E canon) — mode label + display-mode toggle
          + outcome count chips. The toggle is a visual stub until the gradient
          rendering path lands; `Set-difference` is the current behavior. */}
      <div
        aria-hidden={focusNodeId ? "true" : undefined}
        {...(focusNodeId ? { inert: "" } : {})}
        className={`absolute top-3 left-3 flex items-center gap-3 pointer-events-none ${focusNodeId ? "opacity-0 -z-10" : ""}`}
      >
        <span
          className="text-[10px] font-semibold tracking-wider"
          style={{ color: THEME.subtleText, letterSpacing: "0.08em" }}
        >
          OVERLAY · CONFORMANCE
        </span>
        <div
          className="flex items-center rounded-md bg-white border overflow-hidden pointer-events-auto"
          style={{ borderColor: THEME.chromeBorder }}
          role="group"
          aria-label="Display mode (Set-difference active; Gradient lands in v0.4)"
        >
          <span className="sr-only">Gradient mode not yet available; Set-difference is the only display mode in this build.</span>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="px-2 py-0.5 text-[10px] opacity-50 cursor-not-allowed"
            style={{ color: THEME.subtleText }}
            title="Gradient rendering lands in v0.4. Set-difference is the current mode."
          >
            Gradient
          </button>
          <button
            type="button"
            aria-pressed={true}
            className="px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: VIOLET, color: "white" }}
            title="Highlights edges traversed in only passing or only failing runs."
          >
            Set-difference
          </button>
        </div>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "rgba(82, 168, 107, 0.12)", color: PASS_GREEN }}>
          pass-only ({counts["pass-only"]})
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "rgba(217, 82, 82, 0.12)", color: FAIL_RED }}>
          fail-only ({counts["fail-only"]})
        </span>
        {counts.untracked > 0 ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "rgba(80, 120, 200, 0.12)", color: THEME.untrackedSwatch }}>
            {counts.untracked} untracked
          </span>
        ) : null}
        {hiddenEdgeCount > 0 ? (
          <span className="text-[10px]" style={{ color: THEME.subtleText }}>
            +{hiddenEdgeCount} hidden by tool toggle
          </span>
        ) : null}
      </div>

      {/* Breadcrumb — always-mounted so the polite region stays stable. */}
      <DrillBreadcrumb chain={drillChain} active={!!focusNodeId} onExit={() => exitDrill(undefined, "mouse")} onPopTo={(depth) => popToDepth(depth, undefined, "mouse")} />

      {/* Fixed-position strip label — sits outside the zoom transform so
          it stays readable at any scale. Mirrors the legend chip's anchoring
          pattern. Gated on at least one positioned non-file node so the
          label never hangs over an empty strip. */}
      {drawHeight < height && showActions && nodePositionsList.some(([, p]) => p.kind !== "file") ? (
        <div
          className="absolute left-3 pointer-events-none text-[10px] font-semibold tracking-wider"
          style={{ top: drawHeight + LAYOUT.offset.stripLabelTopGap, color: THEME.subtleText, letterSpacing: "0.08em" }}
        >
          ACTION NODES ({actionNodeCount})
        </div>
      ) : null}

      {/* Bottom-right chip cluster — show-tool-nodes, Fit, legend pack as
          a single horizontal flex strip so the three chips never overlap
          regardless of canvas width. Render order = left-to-right visual
          order. Replaces three hardcoded `right:` magic numbers. */}
      <div role="group" aria-label="Visualization controls" className="absolute bottom-3 right-3 flex items-center gap-2" style={{ fontSize: LAYOUT.fontSize.chip }}>
        {actionNodeCount > 0 ? (
          <button
            type="button"
            aria-pressed={showActions}
            onClick={() => setShowActions((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border hover:border-[rgba(124,58,237,0.5)] cursor-pointer"
            style={{ borderColor: THEME.chromeBorder }}
          >
            <span
              className="inline-block rounded-full"
              style={{
                width: 8,
                height: 8,
                border: `1.5px solid ${VIOLET}`,
                background: showActions ? VIOLET : "white",
              }}
            />
            <span style={{ color: THEME.bodyText }}>
              {`Actions${
                showActions && actionNodeCount > LAYOUT.maxActionNodes
                  ? ` (${LAYOUT.maxActionNodes} of ${actionNodeCount})`
                  : ` (${actionNodeCount})`
              }`}
            </span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={resetView}
          className="px-2.5 py-1.5 rounded-md bg-white border hover:border-[rgba(124,58,237,0.5)] cursor-pointer"
          style={{ color: THEME.mutedText, borderColor: THEME.chromeBorder }}
          title="Fit content to view (or double-click empty canvas)"
        >Fit to view</button>
        <div ref={legendRefCallback} role="group" aria-labelledby="conformance-legend-heading" className="flex flex-col items-start gap-1.5 px-3 py-2 rounded-md bg-white border" style={{ borderColor: THEME.chromeBorder }}>
          <h3
            id="conformance-legend-heading"
            className="text-[9px] font-semibold tracking-wider"
            style={{ color: THEME.subtleText, letterSpacing: "0.1em" }}
          >
            CONFORMANCE
          </h3>
          <LegendInline
            color={PASS_GREEN}
            dashed={false}
            label={`pass-only (${counts["pass-only"]})`}
            description="Edge traversed in passing runs only."
          />
          <LegendInline
            color={FAIL_RED}
            dashed={true}
            label={`fail-only (${counts["fail-only"]})`}
            description="Edge traversed in failing runs only: the divergence signal."
          />
          <LegendInline
            color={SHARED_GREY}
            dashed={false}
            label={`shared (${counts.shared})`}
            description="Edge traversed in both passing and failing runs."
          />
          {counts.untracked > 0 ? (
            <LegendInline
              color={THEME.untrackedSwatch}
              dashed={true}
              label={`untracked (${counts.untracked})`}
              description="Transition observed without pass/fail attribution (setup, teardown, or aborted run)."
            />
          ) : null}
        </div>
      </div>

      {/* Empty-state chip — fires when there's no fail-only divergence
          to inspect. Tells the user the visualization is operating on
          clean-conformance data rather than looking broken. Suppressed
          while drilled in so the top-center breadcrumb stays visible. */}
      {/* Stable sr-only live region — always mounted so drill-in/out
          doesn't cycle the polite host. Body falls to empty string
          when the chip is hidden. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {isEmptyConformance && !focusNodeId
          ? noEdgesPlaced
            ? "No edges placed"
            : untrackedOnly
            ? "Untracked only"
            : sharedOnly
            ? `Shared only. All ${placedEdges.length} edges carry both pass and fail traffic. No fail-only divergence: every transition agrees on at least one pass outcome.`
            : `Clean conformance. All ${placedEdges.length} edges are pass-only or untracked. No fail-only divergence. To surface fail-only edges, introduce a failing test case and re-run.`
          : ""}
      </div>
      {isEmptyConformance && !focusNodeId ? (
        <div
          className="absolute px-3 py-2 rounded-md bg-white border pointer-events-none"
          style={{ maxWidth: LAYOUT.emptyStateMaxWidth, bottom: ACTIONS_STRIP_HEIGHT + legendHeight + 24, right: 12, borderColor: THEME.chromeBorder }}
        >
          {noEdgesPlaced ? (
            <>
              <div className="text-[10px] font-medium tracking-wider mb-1" style={{ color: VIOLET }}>NO EDGES PLACED</div>
              <div className="text-[11px]" style={{ color: THEME.mutedText }}>
                This run produced no edges to render, or every edge pointed to nodes outside the visible tree. Inspect the run log under .runograph/runs/ for raw graph data.
              </div>
            </>
          ) : untrackedOnly ? (
            <>
              <div className="text-[10px] font-medium tracking-wider mb-1" style={{ color: VIOLET }}>UNTRACKED ONLY</div>
              <div className="text-[11px]" style={{ color: THEME.mutedText }}>
                {counts.untracked} transition{counts.untracked === 1 ? "" : "s"} recorded but none have pass/fail outcome. The harness did not emit pass/fail metadata for this run.
              </div>
            </>
          ) : sharedOnly ? (
            <>
              <div className="text-[10px] font-medium tracking-wider mb-1" style={{ color: VIOLET }}>SHARED ONLY</div>
              <div className="text-[11px]" style={{ color: THEME.mutedText }}>
                All {placedEdges.length} edges are shared: each carries both pass and fail traffic. No fail-only divergence; every transition agrees on at least one pass outcome.
              </div>
            </>
          ) : (
            <>
              <div className="text-[10px] font-medium tracking-wider mb-1" style={{ color: VIOLET }}>CLEAN CONFORMANCE</div>
              <div className="text-[11px]" style={{ color: THEME.mutedText }}>
                No fail-only divergence in this run. All {placedEdges.length} edges are pass-only or untracked. Surface fail-only by introducing a failing test case and re-running.
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* Interaction hint — only shows when nothing is hovered/selected,
          so it doesn't compete with the inspector. */}
      {!hoverEdge && !hoverNode ? (
        <div
          aria-hidden="true"
          className="absolute bottom-3 left-3 text-[10px] pointer-events-none max-w-[60%]"
          style={{ fontFamily: "monospace", color: THEME.subtleText }}
        >
          {selectedNode
            ? "click bg = deselect · Escape steps back"
            : "hover/click = inspect/pin · drag/wheel = pan/zoom · dbl-click = fit"}
        </div>
      ) : null}

      {/* Pinned-content polite region: announces only on selection
          transitions (NOT on hover). Stable id is wired to the focused
          hit-test ring via aria-describedby so AT reads the rich
          inspector summary when the user pins a node/edge. */}
      <div
        id="conformance-inspector-summary"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {selectedEdge
          ? (() => {
              const cls = classifyEdge(selectedEdge);
              const pass = selectedEdge.passCount ?? 0;
              const fail = selectedEdge.failCount ?? 0;
              const tx = selectedEdge.count;
              if (cls === "shared")    return `Pinned shared edge from ${selectedEdge.source} to ${selectedEdge.target}. ${pass} pass-only, ${fail} fail-only, ${tx} transition${tx === 1 ? "" : "s"}.`;
              if (cls === "untracked") return `Pinned untracked edge from ${selectedEdge.source} to ${selectedEdge.target}. ${tx} transition${tx === 1 ? "" : "s"}, no outcome attribution.`;
              const n = cls === "pass-only" ? pass : fail;
              return `Pinned ${cls} edge from ${selectedEdge.source} to ${selectedEdge.target}. ${n} run${n === 1 ? "" : "s"}, ${tx} transition${tx === 1 ? "" : "s"}.`;
            })()
          : selectedNode
          ? (() => {
              const pos = nodePositions.get(selectedNode);
              const node = nodeById.get(selectedNode);
              const isDiv = divergenceNodeIds.has(selectedNode);
              const inc = incidentByNode.get(selectedNode) ?? emptyIncident();
              const kindWord = pos?.kind === "file" ? "file" : "action";
              const label = shortLabel(selectedNode, pos?.kind ?? "file");
              const visits = node?.visits ?? 0;
              return `Pinned ${isDiv ? "⚠ divergence " : ""}${kindWord} node ${label}: ${visits} visit${visits === 1 ? "" : "s"}, degree ${inc.count} (${inc["pass-only"]} pass-only, ${inc["fail-only"]} fail-only, ${inc.shared} shared).`;
            })()
          : ""}
      </div>

      {/* Inspector — hover-only OR selection. No always-on auto-focus. */}
      <div className="contents">
        <Inspector
          ref={inspectorRef}
          hoverEdge={hoverEdge}
          kbFocusEdge={kbFocusEdge}
          hoverNode={hoverNode}
          kbFocusNode={kbFocusNode}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          nodePositions={nodePositions}
          nodeById={nodeById}
          divergenceNodeIds={divergenceNodeIds}
          incidentByNode={incidentByNode}
          rawIncidentCountByNode={rawIncidentCountByNode}
        />
      </div>

      {/* Right-click context menu. Closes on item click or any outside
          mousedown via window listener inside the popover. */}
      {ctxMenu ? (
        <ContextMenuPopover
          x={ctxMenu.x}
          y={ctxMenu.y}
          target={ctxMenu.target}
          onClose={closeCtxMenu}
          onAction={onCtxAction}
        />
      ) : null}
    </div>
  );
}
