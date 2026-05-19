import clsx from "clsx";
import type { AnyColorToken } from "@/lib/tokens";

/**
 * Heat-tile — atomic primitive for the corpus heat-map.
 *
 * Represents one file (or one matrix cell). Two axes: productivity (green)
 * and pollution (red). 3×3 = 9 canonical variants matching the Figma master
 * (file OvWgOsrPH5t3hL4l5bIazx, component "Heat-tile" id 13:20).
 *
 * Fill lookup encodes the 3×3 narrative:
 *
 *                 P=low                P=med               P=high
 *   poll=low      bg/sunken           heat/prod/300        heat/prod/500
 *   poll=med      heat/poll/300       status/warning       heat/prod/200
 *   poll=high     heat/poll/500       heat/poll/400        status/warning
 *
 * High prod + low poll = saturated green (clear win).
 * Low prod + high poll = saturated red  (clear loss).
 * Mid-mid + high/high = warning (contested file — worth opening).
 *
 * Always 32×32 with radius/sm + border/hairline. Pixel-locked to Figma.
 */

export type HeatLevel = "low" | "med" | "high";

export interface HeatTileProps {
  productivity: HeatLevel;
  pollution: HeatLevel;
  /** Optional aria-label override; defaults to "P:high · Poll:low" etc. */
  label?: string;
  /** Optional click handler — surfaces as a tooltip / drill-down trigger in real UI. */
  onClick?: () => void;
  /** Optional className extension (testing / debugging only — never override tokens). */
  className?: string;
}

const FILL_BY_AXIS: Record<HeatLevel, Record<HeatLevel, AnyColorToken>> = {
  low: {
    low: "bg/sunken",
    med: "heat/pollution/300",
    high: "heat/pollution/500",
  },
  med: {
    low: "heat/productivity/300",
    med: "status/warning",
    high: "heat/pollution/400",
  },
  high: {
    low: "heat/productivity/500",
    med: "heat/productivity/200",
    high: "status/warning",
  },
};

/** Tailwind class fragment for a token (manual mapping; ensures Tailwind picks them up). */
const TOKEN_BG_CLASS: Record<AnyColorToken, string> = {
  "bg/canvas": "bg-bg-canvas",
  "bg/panel": "bg-bg-panel",
  "bg/elevated": "bg-bg-elevated",
  "bg/sunken": "bg-bg-sunken",
  "text/primary": "bg-text-primary",
  "text/secondary": "bg-text-secondary",
  "text/tertiary": "bg-text-tertiary",
  "text/disabled": "bg-text-disabled",
  "text/accent": "bg-text-accent",
  "border/hairline": "bg-border-hairline",
  "border/subtle": "bg-border-subtle",
  "border/strong": "bg-border-strong",
  "accent/primary": "bg-accent-primary",
  "accent/hover": "bg-accent-hover",
  "accent/pressed": "bg-accent-pressed",
  "heat/productivity/100": "bg-heat-productivity-100",
  "heat/productivity/200": "bg-heat-productivity-200",
  "heat/productivity/300": "bg-heat-productivity-300",
  "heat/productivity/400": "bg-heat-productivity-400",
  "heat/productivity/500": "bg-heat-productivity-500",
  "heat/pollution/100": "bg-heat-pollution-100",
  "heat/pollution/200": "bg-heat-pollution-200",
  "heat/pollution/300": "bg-heat-pollution-300",
  "heat/pollution/400": "bg-heat-pollution-400",
  "heat/pollution/500": "bg-heat-pollution-500",
  "status/success": "bg-status-success",
  "status/warning": "bg-status-warning",
  "status/danger": "bg-status-danger",
  "status/info": "bg-status-info",
};

export function HeatTile({
  productivity,
  pollution,
  label,
  onClick,
  className,
}: HeatTileProps) {
  const fillToken = FILL_BY_AXIS[productivity][pollution];
  const ariaLabel = label ?? `Heat-tile · productivity:${productivity} · pollution:${pollution}`;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={clsx(
        "h-8 w-8 rounded-sm border border-border-hairline transition-opacity",
        "hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary",
        TOKEN_BG_CLASS[fillToken],
        className,
      )}
      data-token={fillToken}
    />
  );
}
