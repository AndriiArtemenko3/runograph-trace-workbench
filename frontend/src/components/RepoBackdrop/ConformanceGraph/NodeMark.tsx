// Per-node mark rendered inside the SVG node layer. Lifted from
// ConformanceGraph.tsx (~226 LOC .map callback). Encapsulates
// the divergence/selected/kbFocus rings, the visible dot (file vs action
// variant), the hit-test ring with keyboard + context-menu wiring, and the
// action-node label. Wrapped in React.memo with a comparator over the values
// that actually drive re-render so single-node hover stops committing all N
// siblings.

import React from "react";
import type { GraphNode } from "../../../api/routes";
import { LAYOUT, THEME } from "./_layout";
import { shortLabel } from "./_classify";
import { findArrowNeighbor, type NodePos, type ArrowDir } from "./_spatial-nav";

const RING_VARIANTS = {
  selected:                { r: LAYOUT.ringR.selected,                sw: 2,   dash: undefined as string | undefined,  op: 1 },
  selectedOverDivergence:  { r: LAYOUT.ringR.selectedOverDivergence,  sw: 2,   dash: undefined as string | undefined,  op: 1 },
  kbFocus:                 { r: LAYOUT.ringR.kbFocus,                 sw: 1.5, dash: "2 2" as string | undefined,      op: 0.8 },
  divergence:              { r: LAYOUT.ringR.divergence,              sw: 1.5, dash: "4 3" as string | undefined,      op: 0.7 },
} as const;

function NodeRing({ variant, cx, cy }: { variant: keyof typeof RING_VARIANTS; cx: number; cy: number }) {
  const v = RING_VARIANTS[variant];
  return (
    <circle cx={cx} cy={cy} r={v.r} fill="none" stroke={THEME.violet}
            strokeWidth={v.sw} strokeDasharray={v.dash} opacity={v.op} />
  );
}

export interface NodeMarkHandlers {
  onSetHover: (id: string | null) => void;
  onSetSelected: (updater: (cur: string | null) => string | null) => void;
  onSetKbFocus: (next: string | ((cur: string | null) => string | null)) => void;
  onSetCtxMenu: (ctx: { x: number; y: number; target: { kind: "node"; id: string } }) => void;
  onEnterDrill: (id: string) => void;
}

export interface NodeMarkProps {
  nodeId: string;
  pos: NodePos;
  isHover: boolean;
  isSelected: boolean;
  isKbFocused: boolean;
  isDivergence: boolean;
  isTouched: boolean;
  fileNode: GraphNode | null;
  // Boolean projection of parent's `focusNodeId` — only the truthiness
  // gate (drill-active vs substrate) actually drives this component's
  // aria-keyshortcuts suffix. Passing a string here would invalidate
  // React.memo on every drill-leaf change; the boolean stays stable
  // within a drill session.
  showsRKey: boolean;
  nodePositions: Map<string, NodePos>;
  nodePositionsList: ReadonlyArray<readonly [string, NodePos]>;
  drillNeighborhood: Set<string> | null;
  svgRef: React.RefObject<SVGSVGElement | null>;
  handlers: NodeMarkHandlers;
}

function NodeMarkInner(p: NodeMarkProps) {
  const {
    nodeId, pos, isHover, isSelected, isKbFocused, isDivergence, isTouched,
    fileNode, showsRKey, nodePositions, nodePositionsList,
    drillNeighborhood, svgRef, handlers,
  } = p;
  const isFile = pos.kind === "file";
  const innerR = isFile ? LAYOUT.fileDot.rFile : LAYOUT.fileDot.rAction;
  const cyAdj = isFile ? pos.cy : pos.cy + LAYOUT.actionLabelOffsetY;
  const handleEnter = () => handlers.onSetHover(nodeId);
  const handleLeave = () => handlers.onSetHover(null);
  const handleClick = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    // Drill modifier: accept either Cmd or Ctrl. navigator.platform is
    // deprecated and spoofed under Firefox RFP / Brave Strict / Safari
    // Lockdown, so platform-detect mis-routes Mac users on privacy-
    // hardened browsers. The canvas binds nothing else to either modifier.
    const wantsDrill = ev.metaKey || ev.ctrlKey;
    if (wantsDrill) {
      handlers.onEnterDrill(nodeId);
    } else {
      handlers.onSetSelected((cur) => (cur === nodeId ? null : nodeId));
    }
  };
  return (
    // Drill-fade opacity carried by parent bright/dimmed <g> wrappers in
    // ConformanceGraph.tsx; per-node opacity stays static.
    <g>
      {isSelected ? (
        <NodeRing
          variant={isDivergence ? "selectedOverDivergence" : "selected"}
          cx={pos.cx}
          cy={cyAdj}
        />
      ) : null}
      {isKbFocused && !isSelected ? (
        <NodeRing variant="kbFocus" cx={pos.cx} cy={cyAdj} />
      ) : null}
      {isDivergence && !(isKbFocused && !isSelected) ? (
        <NodeRing variant="divergence" cx={pos.cx} cy={cyAdj} />
      ) : null}
      {isFile ? (
        <circle
          cx={pos.cx}
          cy={cyAdj}
          r={isHover ? innerR + LAYOUT.fileDot.rHoverBonus : (isTouched ? innerR : innerR - LAYOUT.fileDot.rUntouchedShrink)}
          fill={isTouched ? THEME.violet : THEME.neutralGrey}
          stroke={isTouched ? THEME.violetSoft : THEME.neutralGreyStroke}
          strokeWidth={isTouched ? LAYOUT.stroke.fileNodeTouched : LAYOUT.stroke.fileNodeUntouched}
          pointerEvents="none"
        />
      ) : (
        <circle
          cx={pos.cx}
          cy={cyAdj}
          r={isHover ? innerR + LAYOUT.fileDot.rHoverBonus : innerR}
          fill="white"
          stroke={THEME.violet}
          strokeWidth={isHover ? LAYOUT.stroke.actionNodeHover : LAYOUT.stroke.actionNodeIdle}
          pointerEvents="none"
        />
      )}
      <circle
        cx={pos.cx}
        cy={cyAdj}
        r={isFile ? LAYOUT.ringR.hitTest : LAYOUT.ringR.hitTest + 8}
        fill="rgba(0,0,0,0.001)"
        style={{ cursor: "pointer" }}
        tabIndex={0}
        role="button"
        data-node-id={nodeId}
        aria-label={`${isDivergence ? "divergence " : ""}${pos.kind === "file" ? "file" : "action"} node ${shortLabel(nodeId, pos.kind)}`}
        aria-keyshortcuts={`Enter Space D Shift+F10 ArrowUp ArrowDown ArrowLeft ArrowRight${showsRKey ? " R" : ""}`}
        aria-pressed={isSelected}
        aria-describedby={isSelected ? "conformance-inspector-summary" : undefined}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        onFocus={() => handlers.onSetKbFocus(nodeId)}
        onBlur={() => handlers.onSetKbFocus((cur) => (cur === nodeId ? null : cur))}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            ev.stopPropagation();
            handlers.onSetSelected((cur) => (cur === nodeId ? null : nodeId));
            return;
          }
          if (ev.key === "ContextMenu" || (ev.shiftKey && ev.key === "F10")) {
            ev.preventDefault();
            handlers.onSetHover(nodeId);
            const targetEl = ev.currentTarget as SVGCircleElement;
            const ctm = targetEl.getScreenCTM();
            const localX = pos.cx;
            const localY = cyAdj + innerR + 4;
            const px = ctm ? ctm.a * localX + ctm.c * localY + ctm.e : localX;
            const py = ctm ? ctm.b * localX + ctm.d * localY + ctm.f : localY;
            handlers.onSetCtxMenu({ x: px, y: py, target: { kind: "node", id: nodeId } });
            return;
          }
          if (ev.key === "d" || ev.key === "D") {
            ev.preventDefault();
            handlers.onEnterDrill(nodeId);
            return;
          }
          if (ev.key.startsWith("Arrow")) {
            ev.preventDefault();
            const here = nodePositions.get(nodeId);
            if (!here) return;
            const next = findArrowNeighbor(
              nodeId,
              ev.key as ArrowDir,
              nodePositionsList,
              here.cx,
              here.cy,
              drillNeighborhood,
            );
            if (next) {
              svgRef.current?.querySelector<SVGCircleElement>(
                `[data-node-id="${CSS.escape(next)}"]`,
              )?.focus({ preventScroll: true });
            }
            return;
          }
        }}
        onContextMenu={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          (ev.currentTarget as SVGCircleElement).focus({ preventScroll: true });
          handlers.onSetHover(nodeId);
          handlers.onSetKbFocus(nodeId);
          handlers.onSetCtxMenu({ x: ev.clientX, y: ev.clientY, target: { kind: "node", id: nodeId } });
        }}
      >
        {/* SVG-native tooltip recovery — full path/id on hover.
            Using <desc> instead of <title> so it stays a description-only
            channel; <title> would coerce into a second accessible name
            candidate alongside aria-label, causing double-announce. */}
        <desc>{isFile ? (fileNode?.target ?? nodeId) : shortLabel(nodeId, pos.kind)}</desc>
      </circle>
      {!isFile ? (
        <text
          x={pos.cx}
          y={pos.cy + LAYOUT.offset.actionNodeLabelY}
          aria-hidden="true"
          fontSize={LAYOUT.fontSize.actionNode}
          textAnchor="middle"
          fill={THEME.actionLabelGrey}
          fontFamily="monospace"
          pointerEvents="none"
        >
          {(() => {
            const sl = shortLabel(nodeId, pos.kind);
            return sl.length > LAYOUT.labelTruncateChars
              ? "…" + sl.slice(-(LAYOUT.labelTruncateChars - 1))
              : sl;
          })()}
          <title>{shortLabel(nodeId, pos.kind)}</title>
        </text>
      ) : null}
    </g>
  );
}

export const NodeMark = React.memo(NodeMarkInner, (a, b) =>
  a.nodeId === b.nodeId &&
  a.isHover === b.isHover &&
  a.isSelected === b.isSelected &&
  a.isKbFocused === b.isKbFocused &&
  a.isDivergence === b.isDivergence &&
  a.isTouched === b.isTouched &&
  a.showsRKey === b.showsRKey &&
  a.pos === b.pos &&
  a.fileNode === b.fileNode &&
  a.nodePositions === b.nodePositions &&
  a.nodePositionsList === b.nodePositionsList &&
  a.drillNeighborhood === b.drillNeighborhood,
);
