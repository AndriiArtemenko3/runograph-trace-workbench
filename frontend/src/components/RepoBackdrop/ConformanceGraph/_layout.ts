// Mode E layout + theme canon. Sibling-only consumers (underscore prefix
// signals "module-private to ConformanceGraph"). Lift from
// ConformanceGraph.tsx L47-107 + the six VIOLET/PASS_GREEN/... color consts
// + MIN_FILE_BYTES/TOP_N_DISTRICTS integers. Single source of truth across
// the parent file + Inspector + NodeMark + DrillBreadcrumb + ContextMenuPopover.

export const MIN_FILE_BYTES = 256;
export const TOP_N_DISTRICTS = 5;

// Mode E accent palette (matches Figma canon)
export const THEME = {
  violet: "#7C3AED",
  violetSoft: "rgba(124, 58, 237, 0.35)",
  violetDot: "rgba(124, 58, 237, 0.3)",
  violetDotStroke: "rgba(124, 58, 237, 0.15)",
  passGreen: "#52A86B",
  failRed: "#D95252",
  sharedGrey: "rgba(120, 120, 130, 0.6)",
  // Distinct light-blue so untracked edges don't collide with shared grey.
  untrackedGrey: "rgba(80, 120, 200, 0.5)",
  // Legend swatch hue — neutral grey, distinct from the on-canvas corridor stroke.
  untrackedSwatch: "#A0A0AA",
  // Action-node label colour
  actionLabelGrey: "rgba(80, 80, 90, 1)",
  bodyText: "#1f2937",
  mutedText: "#4b5563",
  subtleText: "#6b7280",
  // Neutral grey for untouched dots (canon: touched=violet, untouched=grey)
  neutralGrey: "rgba(180, 180, 190, 0.6)",
  neutralGreyStroke: "rgba(180, 180, 190, 0.3)",
  // Chrome card border — used by mode-toggle group, Actions chip, Fit chip, legend pack, empty-state card.
  chromeBorder: "rgba(216, 216, 220, 1)",
} as const;

// Layout constants — hoisted from inline magic numbers scattered across the
// component. Group by semantic axis so future tweaks (e.g. "soften all ring
// strokes by 1px") are one-touch instead of grep-and-judge.
export const LAYOUT = {
  inspectorMaxWidth: 320,
  emptyStateMaxWidth: 340,
  chipRightOffset: { toggle: 264, fit: 324 },
  actionsStripHeightOpen: 56,
  ringR: { divergence: 18, selected: 20, kbFocus: 22, hitTest: 12, selectedOverDivergence: 24 },
  zoomDuration: { reset: 250, drill: 450 },
  drillScale: 2.5,
  labelTruncateChars: 14,
  actionLabelOffsetY: -6,
  maxActionNodes: 12,
  prose: { truncatedRowMaxWidth: 280 },
  stroke: {
    districtOutline: 1,
    edgeHover: 1.5,
    edgeHitTest: 16,
    // Stage-7 hoist — leader-line + file-dot + action-node stroke widths.
    leaderLine: 1,
    fileNodeTouched: 3,
    fileNodeUntouched: 1.5,
    actionNodeIdle: 1.5,
    actionNodeHover: 2,
    kbFocusHalo: 8,
  },
  // Stage-7 hoist — file/action dot radii + leader-caret triangle geometry.
  fileDot: { rFile: 6, rAction: 5, rHoverBonus: 1, rUntouchedShrink: 2.5 },
  leaderCaret: { depthPx: 5, halfWidthPx: 3 },
  opacity: {
    edgeDimmed: 0.15,
    edgeBaseShared: 0.55,
    edgeBaseDiagnostic: 0.9,
    nodeDrillDimmed: 0.08,
    leaderLine: 0.5,
    kbFocusHalo: 0.3,
  },
  fontSize: {
    districtName: 11,
    districtCount: 9,
    actionNode: 8,
    breadcrumb: 11,
    chip: 10,
    ctxMenu: 12,
  },
  offset: {
    actionNodeLabelY: 14,
    stripLabelTopGap: 4,
  },
  geom: {
    centerPull: 0.5,
    selfLoopR: 14,
    selfLoopYAnchor: 8,
    selfLoopInsetFactor: 0.6,
    stripMargin: 24,
    drillBboxFloor: 40,
  },
} as const;
