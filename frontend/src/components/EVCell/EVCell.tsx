import clsx from "clsx";

/**
 * EV-cell — renders one matrix-cell EV value.
 *
 * Used in the Solver Grid's EV matrix. Two axes:
 *   - sign:       positive | negative   (decides green vs red)
 *   - magnitude:  1..5                  (decides heat depth)
 *
 * 10 canonical variants matching Figma master "EV-cell" (id 13:51).
 *
 * Layout (per Figma canon, VERTICAL auto-layout, padTRBL [6,8,6,8]):
 *   ┌─────────────────────┐
 *   │       MAG 4         │  ← label on TOP (Inter Regular 10px)
 *   │      +0.247         │  ← numeric on BOTTOM (JetBrains Mono Medium 14px)
 *   └─────────────────────┘
 *   120 × 48, radius/md
 *
 * Text-on-fill contrast rule (REVISED 2026-05-19 — supersedes the v2-canon
 * "text/primary on mag 3-5" rule that turned out to ship at ~2.5:1, below
 * WCAG 4.5:1):
 *
 *   - ALL magnitudes → use `bg/canvas` (#14171C, near-black) for both
 *     label and numeric. On the green/red heat fills (which are saturated
 *     mid-tones, not pure dark), dark text gives 7-12:1 contrast across
 *     every variant.
 *
 * Winner cell: 2px `status/warning` border (the gold ring on Harness B in Solver Grid).
 */

export type EVSign = "positive" | "negative";
export type EVMagnitude = 1 | 2 | 3 | 4 | 5;

export interface EVCellProps {
  /** Label rendered on top, e.g. "MAG 4" or "Harness B". */
  label: string;
  /** Numeric below, e.g. "+0.247". Include the sign character. */
  value: string;
  sign: EVSign;
  magnitude: EVMagnitude;
  /** Winner ring: 2px status/warning border (used on the top harness). */
  winner?: boolean;
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

export function EVCell({
  label,
  value,
  sign,
  magnitude,
  winner = false,
  onClick,
  className,
}: EVCellProps) {
  const fill = FILL_BG[sign][magnitude];
  // Near-black text across ALL fills — 7-12:1 contrast on every heat variant.
  // (The earlier rule that switched to text/primary on mag 3-5 fails WCAG.)
  const textColor = "text-bg-canvas";
  // Winner ring uses `ring` (box-shadow) instead of border, so winner and
  // non-winner cells share identical box dimensions — no 1 px layout jitter
  // between rows. Focus ring is outline-based so it can coexist with the
  // inset winner ring without conflict.
  const ringClass = winner ? "ring-2 ring-inset ring-status-warning" : "";

  return (
    <button
      type="button"
      onClick={onClick}
      // No aria-label — the inner label+value spans already render the
      // visible text the accessible name needs (axe-core requires the
      // visible text to be contained in the accessible name; letting
      // the children carry it is the cleanest path).
      className={clsx(
        // canon: 120×48, radius/md, no stroke by default (winner adds 2px ring)
        "h-12 w-[120px] rounded-md transition-opacity",
        "flex flex-col items-center justify-center",
        // canon padding: padTRBL [6,8,6,8]
        "px-2 py-1.5 gap-0.5",
        "hover:opacity-95",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary",
        fill,
        ringClass,
        className,
      )}
      data-sign={sign}
      data-magnitude={magnitude}
    >
      {/* canon order: LABEL on top */}
      <span className={clsx("font-sans text-[10px] leading-none font-normal", textColor)}>
        {label}
      </span>
      {/* canon order: NUMERIC below — JetBrains Mono Medium 14px (NOT 20px) */}
      <span
        className={clsx(
          "font-mono leading-none rg-tabular",
          // canon: 14px (between Tailwind text-sm 12 and text-md 14 — our scale's md is 14)
          "text-md font-medium",
          textColor,
        )}
      >
        {value}
      </span>
    </button>
  );
}
