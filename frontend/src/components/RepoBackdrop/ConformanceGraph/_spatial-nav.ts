// Spatial arrow-key navigation. Lifted from ConformanceGraph.tsx
// where it lived inside the per-node `.map` render closure (allocated N times
// per render on an N-node graph). Pure given (nodeId, direction, list, here,
// drillNeighborhood) → returns the next node id or null. Caller is responsible
// for the subsequent DOM focus step (svgRef.current?.querySelector(...)).

import type { GraphNode } from "../../../api/routes";

export type ArrowDir = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

export interface NodePos {
  cx: number;
  cy: number;
  nodeId: string;
  kind: GraphNode["kind"];
}

/** Picks the nearest neighbour in the pressed direction by euclidean distance,
 *  restricted to nodes whose centre lies in the dominant quadrant for that
 *  arrow. Falls back to the half-plane if the strict quadrant is empty (keeps
 *  arrow keys from going silently dead on scattered layouts). While drilled,
 *  restricts candidates to the visible 1-hop neighborhood. */
export function findArrowNeighbor(
  nodeId: string,
  direction: ArrowDir,
  nodePositionsList: ReadonlyArray<readonly [string, NodePos]>,
  hereCx: number,
  hereCy: number,
  drillNeighborhood: Set<string> | null,
): string | null {
  // Strict-quadrant primary pass: dominant axis must be ≥ orthogonal axis.
  let best: { id: string; d: number } | null = null;
  for (const [otherId, otherPos] of nodePositionsList) {
    if (drillNeighborhood && !drillNeighborhood.has(otherId)) continue;
    if (otherId === nodeId) continue;
    const dx = otherPos.cx - hereCx;
    const dy = otherPos.cy - hereCy;
    const inDirection =
      direction === "ArrowRight" ? dx > 0 && Math.abs(dx) >= Math.abs(dy) :
      direction === "ArrowLeft"  ? dx < 0 && Math.abs(dx) >= Math.abs(dy) :
      direction === "ArrowDown"  ? dy > 0 && Math.abs(dy) >= Math.abs(dx) :
      direction === "ArrowUp"    ? dy < 0 && Math.abs(dy) >= Math.abs(dx) :
      false;
    if (!inDirection) continue;
    const dist = Math.hypot(dx, dy);
    if (!best || dist < best.d) best = { id: otherId, d: dist };
  }
  if (best) return best.id;
  // Half-plane fallback — relaxed comparator with dominant-axis distance
  // so straight-ahead neighbours win over diagonals.
  for (const [otherId, otherPos] of nodePositionsList) {
    if (drillNeighborhood && !drillNeighborhood.has(otherId)) continue;
    if (otherId === nodeId) continue;
    const dx = otherPos.cx - hereCx;
    const dy = otherPos.cy - hereCy;
    const inHalfPlane =
      direction === "ArrowRight" ? dx > 0 :
      direction === "ArrowLeft"  ? dx < 0 :
      direction === "ArrowDown"  ? dy > 0 :
      direction === "ArrowUp"    ? dy < 0 :
      false;
    if (!inHalfPlane) continue;
    const dominant = (direction === "ArrowLeft" || direction === "ArrowRight") ? Math.abs(dx) : Math.abs(dy);
    if (!best || dominant < best.d) best = { id: otherId, d: dominant };
  }
  return best ? best.id : null;
}
