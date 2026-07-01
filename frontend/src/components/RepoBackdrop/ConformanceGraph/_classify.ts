// Pure data layer for Mode E — edge classification + hierarchy projection +
// short-label derivation + incident-count factory. Lifted from
// ConformanceGraph.tsx L37-184 (excluding RING_VARIANTS/NodeRing which go
// to NodeMark.tsx per stage 4). Sibling consumers: ConformanceGraph.tsx,
// Inspector.tsx, NodeMark.tsx, DrillBreadcrumb.tsx, ContextMenuPopover.tsx.

import type { GraphEdge, GraphNode, RepoTreeNode } from "../../../api/routes";
import { MIN_FILE_BYTES, THEME } from "./_layout";

export interface HierItem {
  name: string;
  kind: "dir" | "file";
  path?: string;
  value: number;
  visits: number;
  totalFiles: number;
  children?: HierItem[];
}

/** Single source of truth for the display short-label of a non-file node id.
 *  Strips the kind prefix once (e.g. "bash:exec-7f3a" → "exec-7f3a"); preserves
 *  any embedded colons in the rest. File-node ids pass through unchanged via
 *  the optional kind guard. Used by the breadcrumb, action label, inspector,
 *  and the context-menu header so the same entity reads identically across
 *  surfaces. */
export function shortLabel(nodeId: string, kind?: GraphNode["kind"]): string {
  if (kind === "file") return nodeId;
  const i = nodeId.indexOf(":");
  return i >= 0 ? nodeId.slice(i + 1) : nodeId;
}

/** Path-aware abbreviation: preserves the leaf segment, walks parents
 *  right-to-left, swaps in a leading "…/" once the accumulator would
 *  exceed `max`. */
export function abbreviatePath(p: string, max: number): string {
  if (p.length <= max) return p;
  const segs = p.split("/");
  if (segs.length <= 1) return "…" + p.slice(-(max - 1));
  const leaf = segs.pop() ?? p;
  if (leaf.length >= max - 2) return "…/" + leaf.slice(-(max - 4));
  let acc = leaf;
  for (let i = segs.length - 1; i >= 0; i--) {
    const next = segs[i] + "/" + acc;
    if (next.length > max - 2) return "…/" + acc;
    acc = next;
  }
  return acc;
}

export function toHierarchy(node: RepoTreeNode): HierItem {
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

/** Classify an edge by its run-outcome breakdown. */
export type EdgeClass = "pass-only" | "fail-only" | "shared" | "untracked";

/** Per-node incident-edge counts. */
export type IncidentCounts = Record<EdgeClass, number> & { count: number };
export const emptyIncident = (): IncidentCounts => ({
  "pass-only": 0, "fail-only": 0, shared: 0, untracked: 0, count: 0,
});

export function classifyEdge(e: GraphEdge): EdgeClass {
  const pass = e.passCount ?? 0;
  const fail = e.failCount ?? 0;
  if (pass > 0 && fail === 0) return "pass-only";
  if (fail > 0 && pass === 0) return "fail-only";
  if (pass > 0 && fail > 0) return "shared";
  return "untracked";
}

export function strokeFor(cls: EdgeClass): { color: string; dashed: boolean } {
  switch (cls) {
    case "pass-only": return { color: THEME.passGreen, dashed: false };
    case "fail-only": return { color: THEME.failRed, dashed: true };
    case "shared":    return { color: THEME.sharedGrey, dashed: false };
    default:          return { color: THEME.untrackedGrey, dashed: true };
  }
}

/** Sort edges so the most diagnostic (fail-only > pass-only > shared) paint last. */
export const Z_ORDER: Record<EdgeClass, number> = {
  shared: 0,
  untracked: 0,
  "pass-only": 1,
  "fail-only": 2,
};
