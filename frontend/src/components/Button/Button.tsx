import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button — chrome action primitive.
 *
 * Variants: `kind` (primary / secondary / icon) × `state` (default / hover /
 * pressed / disabled) = 12. Bit-locked to Figma master "Button" (id 15:26).
 *
 * Canon dimensions: 96×32 for primary/secondary; 32×32 for icon. Radius/md.
 * Canon text: Inter Medium 13px. Canon padding: padTRBL [0,12,0,12].
 *
 * State map (per canon):
 *
 *   primary:
 *     default: fill accent/primary, NO stroke
 *     hover:   fill accent/hover,   NO stroke
 *     pressed: fill accent/pressed, NO stroke
 *     disabled: fill bg/panel, stroke border/subtle, text text/tertiary  ← v2 redteam fix
 *
 *   secondary:
 *     default: fill bg/panel,    stroke border/subtle
 *     hover:   fill bg/elevated, stroke border/subtle  ← LIGHTER on hover
 *     pressed: fill bg/sunken,   stroke border/subtle  ← DARKER on press
 *     disabled: fill bg/panel,   stroke border/hairline, text text/disabled
 *
 *   icon (32×32):
 *     default: fill bg/panel,    stroke border/hairline, glyph text/primary
 *     hover:   fill bg/elevated, stroke border/hairline, glyph text/primary
 *     pressed: fill bg/sunken,   stroke border/hairline, glyph text/primary
 *     disabled: fill bg/panel,   stroke border/hairline, glyph text/disabled
 *
 * Live :hover and :active transitions wired; explicit `state` prop is for
 * Storybook + tests.
 */

export type ButtonKind = "primary" | "secondary" | "icon";
export type ButtonState = "default" | "hover" | "pressed" | "disabled";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  kind?: ButtonKind;
  /** Force a visual state — for Storybook + regression tests. Live UI uses :hover/:active. */
  state?: ButtonState;
  icon?: ReactNode;
  children?: ReactNode;
}

interface StateStyles {
  bg: string;
  /** Empty string means no stroke (primary default/hover/pressed). */
  border: string;
  fg: string;
}

const NO_BORDER = "border-transparent";

const STYLES: Record<ButtonKind, Record<ButtonState, StateStyles>> = {
  primary: {
    default: { bg: "bg-accent-primary", border: NO_BORDER, fg: "text-text-primary" },
    hover: { bg: "bg-accent-hover", border: NO_BORDER, fg: "text-text-primary" },
    pressed: { bg: "bg-accent-pressed", border: NO_BORDER, fg: "text-text-primary" },
    disabled: { bg: "bg-bg-panel", border: "border-border-subtle", fg: "text-text-tertiary" },
  },
  secondary: {
    default: { bg: "bg-bg-panel", border: "border-border-subtle", fg: "text-text-primary" },
    hover: { bg: "bg-bg-elevated", border: "border-border-subtle", fg: "text-text-primary" },
    pressed: { bg: "bg-bg-sunken", border: "border-border-subtle", fg: "text-text-primary" },
    disabled: { bg: "bg-bg-panel", border: "border-border-hairline", fg: "text-text-disabled" },
  },
  icon: {
    default: { bg: "bg-bg-panel", border: "border-border-hairline", fg: "text-text-primary" },
    hover: { bg: "bg-bg-elevated", border: "border-border-hairline", fg: "text-text-primary" },
    pressed: { bg: "bg-bg-sunken", border: "border-border-hairline", fg: "text-text-primary" },
    disabled: { bg: "bg-bg-panel", border: "border-border-hairline", fg: "text-text-disabled" },
  },
};

const LIVE_TRANSITIONS: Record<ButtonKind, string> = {
  primary: "hover:bg-accent-hover active:bg-accent-pressed",
  secondary:
    "hover:bg-bg-elevated active:bg-bg-sunken",
  icon:
    "hover:bg-bg-elevated active:bg-bg-sunken",
};

export function Button({
  kind = "secondary",
  state,
  icon,
  children,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const effectiveState: ButtonState = disabled ? "disabled" : state ?? "default";
  const styles = STYLES[kind][effectiveState];
  const useLiveStates = !disabled && state === undefined;

  const isIconOnly = kind === "icon" && !children;
  // canon: icon 32×32, others 96×32 (we let HUG happen by default via px-3 + flex)
  const sizeClass = isIconOnly ? "w-8 h-8 px-0" : "h-8 px-3";

  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      className={clsx(
        "rounded-md border font-sans font-medium",
        // canon: Inter Medium 13px — our `text-base` token is 13px
        "text-base",
        "inline-flex items-center justify-center gap-1.5",
        "transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-primary",
        sizeClass,
        styles.bg,
        styles.border,
        styles.fg,
        useLiveStates && LIVE_TRANSITIONS[kind],
        disabled && "cursor-not-allowed",
        className,
      )}
      data-kind={kind}
      data-state={effectiveState}
      {...rest}
    >
      {icon && <span className="inline-flex items-center">{icon}</span>}
      {children && <span>{children}</span>}
    </button>
  );
}
