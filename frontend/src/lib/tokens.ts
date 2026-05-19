/**
 * Token name unions — the typed counterpart to tokens.css + tailwind.config.ts.
 *
 * Lets component props accept canonical token names with autocomplete
 * (e.g. `bgFill: "bg/panel"`) without leaking hex literals.
 */

export type SurfaceToken =
  | "bg/canvas"
  | "bg/panel"
  | "bg/elevated"
  | "bg/sunken";

export type TextToken =
  | "text/primary"
  | "text/secondary"
  | "text/tertiary"
  | "text/disabled"
  | "text/accent";

export type BorderToken = "border/hairline" | "border/subtle" | "border/strong";

export type AccentToken = "accent/primary" | "accent/hover" | "accent/pressed";

export type HeatProductivityToken =
  | "heat/productivity/100"
  | "heat/productivity/200"
  | "heat/productivity/300"
  | "heat/productivity/400"
  | "heat/productivity/500";

export type HeatPollutionToken =
  | "heat/pollution/100"
  | "heat/pollution/200"
  | "heat/pollution/300"
  | "heat/pollution/400"
  | "heat/pollution/500";

export type StatusToken =
  | "status/success"
  | "status/warning"
  | "status/danger"
  | "status/info";

export type AnyColorToken =
  | SurfaceToken
  | TextToken
  | BorderToken
  | AccentToken
  | HeatProductivityToken
  | HeatPollutionToken
  | StatusToken;

/** Map a token name to its Tailwind utility-class fragment for backgroundColor. */
export function bgClass(token: AnyColorToken): string {
  return `bg-${token.replace(/\//g, "-")}`;
}

/** Map a token name to its Tailwind utility-class fragment for color (text). */
export function textClass(token: AnyColorToken): string {
  return `text-${token.replace(/\//g, "-")}`;
}

/** Map a token name to its Tailwind utility-class fragment for border. */
export function borderColorClass(token: AnyColorToken): string {
  return `border-${token.replace(/\//g, "-")}`;
}

/** Map a token name to its raw CSS variable (for inline-style edge cases). */
export function cssVar(token: AnyColorToken): string {
  return `var(--rg-${token.replace(/\//g, "-")})`;
}
