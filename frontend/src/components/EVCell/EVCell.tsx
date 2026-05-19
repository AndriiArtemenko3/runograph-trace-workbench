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
 * Text-on-fill contrast rule (v2 redteam fix locked in canon):
 *   - magnitude 1-2 → light fills (heat/*-100, heat/*-200): use `bg/canvas` text
 *   - magnitude 3-5 → darker fills: use `text/primary` for BOTH label and numeric
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

const isLightFill = (m: EVMagnitude): boolean => m <= 2;

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
  const light = isLightFill(magnitude);
  const textColor = light ? "text-bg-canvas" : "text-text-primary";
  const ringClass = winner
    ? "border-status-warning border-2"
    : "border-transparent border";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} · EV ${value}`}
      className={clsx(
        // canon: 120×48, radius/md, no stroke by default (winner adds 2px ring)
        "h-12 w-[120px] rounded-md transition-opacity",
        "flex flex-col items-center justify-center",
        // canon padding: padTRBL [6,8,6,8]
        "px-2 py-1.5 gap-0.5",
        "hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary",
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
