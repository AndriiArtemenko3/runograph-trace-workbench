// Drill-mode top-center breadcrumb. Lifted from ConformanceGraph.tsx.
// Always-mounted host so the polite region stays stable across A→B re-drills.
// Container visibility toggles via opacity / pointer-events / z-index when
// not drilled. v6: renders the full drillStack chain (depth-N) with
// click-to-pop-to-depth per frame; leaf carries aria-current="location".

import { Fragment, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { LAYOUT, THEME } from "./_layout";
import { abbreviatePath } from "./_classify";

export interface DrillBreadcrumbFrame {
  label: string;
  nodeId: string;
}

export interface DrillBreadcrumbProps {
  chain: DrillBreadcrumbFrame[];
  active: boolean;
  onExit: () => void;
  onPopTo: (depth: number) => void;
}

export function DrillBreadcrumb({ chain, active, onExit, onPopTo }: DrillBreadcrumbProps) {
  const leafLabel = chain.length > 0 ? chain[chain.length - 1]?.label ?? null : null;
  // Drill-exit announcement: polite regions go silent when text transitions
  // to "" in most AT (NVDA, JAWS). Emit an explicit exit string for ~400ms
  // on the `active` true→false edge so the user gets confirmation. Mirrors
  // the always-mounted+falls-to-empty pattern in ConformanceGraph.tsx.
  const [exitMsg, setExitMsg] = useState<string>("");
  const prevActiveRef = useRef<boolean>(active);
  useEffect(() => {
    if (prevActiveRef.current && !active) {
      setExitMsg("Exited drill. Back to substrate root.");
      const t = setTimeout(() => setExitMsg(""), 400);
      prevActiveRef.current = active;
      return () => clearTimeout(t);
    }
    prevActiveRef.current = active;
  }, [active]);
  const segmentStyle = {
    minWidth: 24,
    minHeight: 24,
    padding: "0 4px",
    display: "inline-flex",
    alignItems: "center",
    background: "transparent",
    border: "none",
    cursor: "pointer",
  } as const;
  return (
    <div
      aria-hidden={!active ? "true" : undefined}
      {...(!active ? { inert: "" } : {})}
      className={clsx(
        "absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-md bg-white border border-[rgba(216,216,220,1)] shadow-sm max-w-[80%] overflow-hidden",
        !active && "opacity-0 pointer-events-none -z-10"
      )}
      style={{ fontSize: LAYOUT.fontSize.breadcrumb }}
    >
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {active && leafLabel
          ? `Drilled into ${leafLabel}. Press Escape to step back one level, or activate the exit button to leave drill entirely.`
          : exitMsg}
      </div>
      {active ? (
        <nav aria-label="Drill breadcrumb" className="flex items-center gap-2">
          <button
            type="button"
            aria-label="substrate"
            onClick={onExit}
            className="font-mono hover:underline"
            style={{ color: THEME.subtleText, ...segmentStyle }}
          >
            substrate
          </button>
          {chain.map((f, i) => {
            const isLeaf = i === chain.length - 1;
            // Leaf is the current-location segment (violet) — never clip it.
            // Mid-frames compress to 140px and truncate first so the leaf
            // stays full-width even at depth ≥ 4 on narrow viewports.
            const segmentMax = isLeaf
              ? LAYOUT.prose.truncatedRowMaxWidth
              : Math.min(140, LAYOUT.prose.truncatedRowMaxWidth);
            return (
              <Fragment key={`${i}-${f.nodeId}`}>
                <span style={{ color: THEME.subtleText }} aria-hidden="true">/</span>
                <button
                  type="button"
                  onClick={isLeaf ? undefined : () => onPopTo(i)}
                  tabIndex={isLeaf ? -1 : undefined}
                  aria-current={isLeaf ? "location" : undefined}
                  aria-disabled={isLeaf ? "true" : undefined}
                  aria-label={isLeaf ? f.label : `Pop drill to ${f.label}`}
                  className="font-mono hover:underline"
                  style={{
                    color: isLeaf ? THEME.violet : THEME.subtleText,
                    maxWidth: segmentMax,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    flexShrink: isLeaf ? 0 : 1,
                    ...segmentStyle,
                  }}
                  title={f.label}
                >
                  {abbreviatePath(f.label, 36)}
                </button>
              </Fragment>
            );
          })}
          <button
            type="button"
            onClick={onExit}
            className="ml-1 hover:underline inline-flex items-center justify-center"
            style={{ color: THEME.subtleText, minWidth: 24, minHeight: 24 }}
            aria-label="Exit drill"
          >
            ×
          </button>
        </nav>
      ) : null}
    </div>
  );
}
