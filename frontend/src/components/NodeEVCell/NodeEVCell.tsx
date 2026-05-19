import clsx from "clsx";
import type { EVSign, EVMagnitude } from "../EVCell";

/**
 * Node-EV-cell — compact numeric-only EV cell for dense tables (Stage
 * decomposition, per-harness signal contribution, downstream-impact
 * grids).
 *
 * Canon: Figma master 14:22 (page 02 Components v2). 64×32, rounded-sm
 * (canon 3 px), JetBrains Mono Medium 13 px, single numeric child. No
 * label row — that's the difference vs the bigger EV-cell atom (which is
 * 120×48 with a label-on-top layout).
 *
 * 10 variants: sign × magnitude.
 *
 * Text-on-fill contrast: ALL fills use bg/canvas (#14171c) for the
 * numeric — matches the revised rule applied to EV-cell. The canon
 * still hints at light text on mag 3-5, but that fails WCAG-AA (~2.5:1)
 * just like the original EV-cell rule it supersedes.
 */

export interface NodeEVCellProps {
  /** Display string with sign, e.g. "+0.31" or "−0.07". */
  value: string;
  sign: EVSign;
  magnitude: EVMagnitude;
  /** Optional click handler — wires data-* attrs for testing. */
  onClick?: () => void;
  className?: string;
}

const FILL_BG: Record<EVSign, Record<EVMagnitude, string>> = {
  positive: {
    1: "bg-heat-productivity-100",
    2: "bg-heat-productivity-200",
    3: "bg-heat-productivity-300",
    4: "bg-heat-productivity-400",
    5: "bg-heat-productivity-500",
  },
  negative: {
    1: "bg-heat-pollution-100",
    2: "bg-heat-pollution-200",
    3: "bg-heat-pollution-300",
    4: "bg-heat-pollution-400",
    5: "bg-heat-pollution-500",
  },
};

export function NodeEVCell({
  value,
  sign,
  magnitude,
  onClick,
  className,
}: NodeEVCellProps) {
  const fill = FILL_BG[sign][magnitude];
  const isInteractive = onClick !== undefined;
  const Tag = isInteractive ? "button" : "div";
  return (
    <Tag
      type={isInteractive ? "button" : undefined}
      onClick={onClick}
      className={clsx(
        // Canon dims: 64×32, rounded-sm. Tabular-nums keeps columns aligned
        // across rows so "+0.31" and "−0.07" don't drift vertically.
        "h-8 w-16 rounded-sm flex items-center justify-center",
        "font-mono text-sm font-medium tabular-nums leading-none",
        "text-bg-canvas",
        isInteractive &&
          "transition-opacity hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary",
        fill,
        className,
      )}
      data-sign={sign}
      data-magnitude={magnitude}
    >
      {value}
    </Tag>
  );
}
