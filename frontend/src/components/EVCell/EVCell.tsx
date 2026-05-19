import clsx from "clsx";

/**
 * EV-cell — renders one matrix-cell EV value.
 *
 * Used in the Solver Grid's 4-column EV matrix (one cell per harness).
 * Two axes:
 *   - sign:       positive | negative   (decides green vs red)
 *   - magnitude:  1..5                  (decides heat depth)
 *
 * 10 canonical variants matching the Figma master "EV-cell" (file
 * OvWgOsrPH5t3hL4l5bIazx, component id 13:51).
 *
 * Layout: large mono numeric (font/mono, 22px) on a heat-token fill, with a
 * small Inter caption underneath. 48px tall (v2 redteam reduced from 56).
 *
 * The text-on-fill contrast rule (from the v2 redteam fix):
 *   - magnitude 1-2: light heat fills (e.g. heat/productivity/200 #7CDDB7).
 *                    Use `bg/canvas` for both numeric and caption so the
 *                    dark text reads on the light fill.
 *   - magnitude 3-5: darker heat fills. Use `text/primary` for numeric,
 *                    `text/secondary` for caption.
 */

export type EVSign = "positive" | "negative";
export type EVMagnitude = 1 | 2 | 3 | 4 | 5;

export interface EVCellProps {
  /** The numeric value to display, e.g. "+0.52" or "−0.30". Sign included. */
  value: string;
  /** Caption underneath the numeric, e.g. "+EV · 50 runs". */
  caption?: string;
  /** Sign axis — picks the heat hue (productivity green vs pollution red). */
  sign: EVSign;
  /** Magnitude axis 1-5 — picks the heat depth + text color rule. */
  magnitude: EVMagnitude;
  /**
   * Mark this cell as the winner — adds a 2px status/warning gold border.
   * Used on the Harness B cell in the Solver Grid.
   */
  winner?: boolean;
  /** Optional click handler for drill-down. */
  onClick?: () => void;
  className?: string;
}

const FILL_BG_CLASS: Record<EVSign, Record<EVMagnitude, string>> = {
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

const isLightFill = (magnitude: EVMagnitude): boolean => magnitude <= 2;

export function EVCell({
  value,
  caption,
  sign,
  magnitude,
  winner = false,
  onClick,
  className,
}: EVCellProps) {
  const fill = FILL_BG_CLASS[sign][magnitude];
  const light = isLightFill(magnitude);
  const numericColor = light ? "text-bg-canvas" : "text-text-primary";
  const captionColor = light ? "text-bg-canvas" : "text-text-secondary";
  const ringClass = winner
    ? "border-status-warning border-2"
    : "border-border-hairline border";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`EV ${value}${caption ? ` · ${caption}` : ""}`}
      className={clsx(
        "h-12 w-[120px] rounded-md transition-opacity",
        "flex flex-col items-center justify-center gap-px",
        "px-3 py-2",
        "hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary",
        fill,
        ringClass,
        className,
      )}
      data-sign={sign}
      data-magnitude={magnitude}
    >
      <span className={clsx("font-mono text-xl rg-tabular leading-none", numericColor)}>
        {value}
      </span>
      {caption && (
        <span className={clsx("text-[10px] leading-none mt-0.5", captionColor)}>
          {caption}
        </span>
      )}
    </button>
  );
}
