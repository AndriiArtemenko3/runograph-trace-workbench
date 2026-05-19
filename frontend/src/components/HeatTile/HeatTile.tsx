import clsx from "clsx";

/**
 * Heat-tile — atomic primitive for the corpus heat-map.
 *
 * Represents one file (or one matrix cell). Two axes encoded as STACKED
 * RECTANGLES (per Figma canon master 13:20):
 *   - Outer 32×32 rect: fill encodes POLLUTION (heat/pollution/100..500)
 *   - Inner 20×20 rect (centered): fill encodes PRODUCTIVITY (heat/productivity/100..500)
 *
 * Read direction:
 *   - High productivity, low pollution → small saturated-green tile in pink frame
 *   - Low productivity, high pollution  → small pale-green tile in deep-red frame
 *   - High/high                          → saturated green in saturated red frame (contested)
 *
 * No border on the outer rect (matches Figma master exactly).
 *
 * Bit-locked to Figma component "Heat-tile" (id 13:20) — 9 variants total.
 */

export type HeatLevel = "low" | "med" | "high";

export interface HeatTileProps {
  productivity: HeatLevel;
  pollution: HeatLevel;
  /** aria-label override; defaults to "productivity:high · pollution:low". */
  label?: string;
  onClick?: () => void;
  className?: string;
}

const POLLUTION_BG: Record<HeatLevel, string> = {
  low: "bg-heat-pollution-100",
  med: "bg-heat-pollution-300",
  high: "bg-heat-pollution-500",
};

const PRODUCTIVITY_BG: Record<HeatLevel, string> = {
  low: "bg-heat-productivity-100",
  med: "bg-heat-productivity-300",
  high: "bg-heat-productivity-500",
};

export function HeatTile({
  productivity,
  pollution,
  label,
  onClick,
  className,
}: HeatTileProps) {
  const ariaLabel =
    label ?? `Heat-tile · productivity:${productivity} · pollution:${pollution}`;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={clsx(
        // outer 32×32: pollution heat
        "relative h-8 w-8 rounded-sm transition-opacity",
        "hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary",
        POLLUTION_BG[pollution],
        className,
      )}
      data-pollution={pollution}
      data-productivity={productivity}
    >
      {/* inner 20×20 (centered): productivity heat */}
      <span
        aria-hidden
        className={clsx(
          "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
          "h-5 w-5 rounded-sm",
          PRODUCTIVITY_BG[productivity],
        )}
      />
    </button>
  );
}
