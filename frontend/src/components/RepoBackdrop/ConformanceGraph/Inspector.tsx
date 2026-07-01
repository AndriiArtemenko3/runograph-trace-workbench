// Inspector card. Lifted from ConformanceGraph.tsx (96-LOC IIFE).
// Hover-frequency render path → React.memo with comparator over the four
// identity fields that drive priority (hoverEdge > kbFocusEdge > hoverNode
// > kbFocusNode > selectedEdge > selectedNode). forwardRef preserves the
// parent's measuredAnchor contract.

import React from "react";
import type { GraphNode, GraphEdge } from "../../../api/routes";
import { LAYOUT, THEME } from "./_layout";
import { classifyEdge, emptyIncident, shortLabel, type IncidentCounts } from "./_classify";
import type { NodePos } from "./_spatial-nav";

export interface InspectorProps {
  hoverEdge: GraphEdge | null;
  kbFocusEdge: GraphEdge | null;
  hoverNode: string | null;
  kbFocusNode: string | null;
  selectedNode: string | null;
  selectedEdge: GraphEdge | null;
  nodePositions: Map<string, NodePos>;
  nodeById: Map<string, GraphNode>;
  divergenceNodeIds: Set<string>;
  incidentByNode: Map<string, IncidentCounts>;
  rawIncidentCountByNode: Map<string, number>;
}

function InspectorInner(p: InspectorProps, ref: React.Ref<HTMLDivElement>) {
  const {
    hoverEdge, kbFocusEdge, hoverNode, kbFocusNode, selectedNode, selectedEdge,
    nodePositions, nodeById, divergenceNodeIds, incidentByNode, rawIncidentCountByNode,
  } = p;
  // Priority: hovered edge > kb-focused edge > hovered node > kb-focused node > selected edge > selected node
  const edgeShown = hoverEdge ?? kbFocusEdge ?? selectedEdge;
  const nodeIdShown = !edgeShown ? (hoverNode ?? kbFocusNode ?? selectedNode) : null;
  if (edgeShown) {
    const cls = classifyEdge(edgeShown);
    const label =
      cls === "fail-only" ? "FAIL-ONLY EDGE" :
      cls === "pass-only" ? "PASS-ONLY EDGE" :
      cls === "shared"    ? "SHARED EDGE" :
      "UNTRACKED EDGE";
    const pass = edgeShown.passCount ?? 0;
    const fail = edgeShown.failCount ?? 0;
    const runs = pass + fail;
    return (
      <div ref={ref} aria-hidden="true" className="absolute top-3 right-3 px-3 py-2.5 rounded-md bg-white border pointer-events-none shadow-lg"
           style={{ borderColor: THEME.violet, maxWidth: LAYOUT.inspectorMaxWidth }}>
        <div className="text-[10px] font-semibold tracking-wider mb-1" style={{ color: THEME.violet }}>
          {label}
        </div>
        <div className="font-mono text-xs mb-0.5" style={{ color: THEME.bodyText }}>{edgeShown.source}</div>
        <div className="font-mono text-xs mb-1" style={{ color: THEME.subtleText }}>↓</div>
        <div className="font-mono text-xs mb-1.5" style={{ color: THEME.bodyText }}>{edgeShown.target}</div>
        {runs > 0 ? (
          <div className="text-[10px]" style={{ color: THEME.mutedText }}>
            {edgeShown.count} transition{edgeShown.count === 1 ? "" : "s"} across {runs} run{runs === 1 ? "" : "s"}
            {" · "}
            <span style={{ color: THEME.passGreen }}>{pass} pass-only</span>
            {" · "}
            <span style={{ color: THEME.failRed }}>{fail} fail-only</span>
          </div>
        ) : (
          <div className="text-[10px]" style={{ color: THEME.mutedText }}>
            {edgeShown.count} transition{edgeShown.count === 1 ? "" : "s"} · no outcome attribution
          </div>
        )}
      </div>
    );
  }
  if (nodeIdShown) {
    const pos = nodePositions.get(nodeIdShown);
    if (!pos) return null;
    const node = nodeById.get(nodeIdShown);
    const isDivergence = divergenceNodeIds.has(nodeIdShown);
    const inc = incidentByNode.get(nodeIdShown) ?? emptyIncident();
    const incidentCount = inc.count;
    const raw = rawIncidentCountByNode.get(nodeIdShown) ?? 0;
    const hidden = raw - incidentCount;
    return (
      <div ref={ref} aria-hidden="true" className="absolute top-3 right-3 px-3 py-2.5 rounded-md bg-white border pointer-events-none shadow-lg"
           style={{ borderColor: THEME.violet, maxWidth: LAYOUT.inspectorMaxWidth }}>
        <div className="text-[10px] font-semibold tracking-wider mb-1" style={{ color: THEME.violet }}>
          {isDivergence ? "⚠ DIVERGENCE NODE" : (pos.kind === "file" ? "FILE NODE" : "ACTION NODE")}
        </div>
        <div className="font-mono text-xs mb-1.5 break-all" style={{ color: THEME.bodyText }}>
          {pos.kind === "file" ? (node?.target || nodeIdShown) : shortLabel(nodeIdShown)}
        </div>
        <div className="text-[10px] mb-0.5" style={{ color: THEME.mutedText }}>
          {node?.visits ?? 0} visit{(node?.visits ?? 0) === 1 ? "" : "s"}
        </div>
        {(node?.errorCount ?? 0) > 0 ? (
          <div className="text-[10px] mb-0.5" style={{ color: THEME.failRed }}>
            {node?.errorCount} error{node?.errorCount === 1 ? "" : "s"}
          </div>
        ) : null}
        <div className="text-[10px]" style={{ color: THEME.mutedText }}>
          degree {incidentCount}
          {hidden > 0 ? (
            <span style={{ fontStyle: "italic", color: THEME.subtleText }}>
              {" "}· +{hidden} not currently rendered
            </span>
          ) : null}
          {" · "}
          <span style={{ color: THEME.passGreen }}>{inc["pass-only"]} pass-only</span>
          {" · "}
          <span style={{ color: THEME.failRed }}>{inc["fail-only"]} fail-only</span>
          {" · "}
          <span style={{ color: THEME.subtleText }}>{inc.shared} shared</span>
          {" · "}
          <span style={{ color: THEME.subtleText }}>{inc.untracked} untracked</span>
        </div>
      </div>
    );
  }
  return null;
}

export const Inspector = React.memo(
  React.forwardRef<HTMLDivElement, InspectorProps>(InspectorInner),
  (a, b) =>
    a.hoverEdge === b.hoverEdge &&
    a.kbFocusEdge === b.kbFocusEdge &&
    a.hoverNode === b.hoverNode &&
    a.kbFocusNode === b.kbFocusNode &&
    a.selectedNode === b.selectedNode &&
    a.selectedEdge === b.selectedEdge &&
    a.nodePositions === b.nodePositions &&
    a.nodeById === b.nodeById &&
    a.divergenceNodeIds === b.divergenceNodeIds &&
    a.incidentByNode === b.incidentByNode &&
    a.rawIncidentCountByNode === b.rawIncidentCountByNode,
);
