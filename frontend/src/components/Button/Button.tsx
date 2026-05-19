import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button — chrome action primitive.
 *
 * Variants: \`kind\` (primary / secondary / icon) × \`state\` (default / hover /
 * pressed / disabled) = 12. Bit-locked to Figma master "Button" (file
 * OvWgOsrPH5t3hL4l5bIazx, component set id 15:26).
 *
 * Height fixed at 32px for v0.3 alpha — one size, no size variants.
 *
 * v2 redteam fix applied: primary-disabled uses bg/panel + text/tertiary +
 * border/subtle (≥3:1 contrast). The previous bg/elevated + text/disabled
 * was 1.4:1 — a hard WCAG fail.
 *
 * Hover/pressed states cycle the accent fill: accent/primary → accent/hover →
 * accent/pressed. The :hover and :active CSS pseudo-classes drive the
 * runtime state; the explicit \`state\` prop is for Storybook + tests.
 */

export type ButtonKind = "primary" | "secondary" | "icon";
export type ButtonState = "default" | "hover" | "pressed" | "disabled";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  kind?: ButtonKind;
  /** Forces a visual state — primarily for Storybook + tests. Live UI uses :hover/:active. */
  state?: ButtonState;
  icon?: ReactNode;
  children?: ReactNode;
}

interface StateStyles {
  bg: string;
  border: string;
  fg: string;
}

const STYLES: Record<ButtonKind, Record<ButtonState, StateStyles>> = {
  primary: {
    default: {
      bg: "bg-accent-primary",
      border: "border-accent-primary",
      fg: "text-text-primary",
    },
    hover: {
      bg: "bg-accent-hover",
      border: "border-accent-hover",
      fg: "text-text-primary",
    },
    pressed: {
      bg: "bg-accent-pressed",
      border: "border-accent-pressed",
      fg: "text-text-primary",
    },
    disabled: {
      bg: "bg-bg-panel",
      border: "border-border-subtle",
      fg: "text-text-tertiary",
    },
  },
  secondary: {
    default: {
      bg: "bg-bg-elevated",
      border: "border-border-subtle",
      fg: "text-text-primary",
    },
    hover: {
      bg: "bg-bg-panel",
      border: "border-border-strong",
      fg: "text-text-primary",
    },
    pressed: {
      bg: "bg-bg-sunken",
      border: "border-border-strong",
      fg: "text-text-primary",
    },
    disabled: {
      bg: "bg-bg-sunken",
      border: "border-border-hairline",
      fg: "text-text-disabled",
    },
  },
  icon: {
    default: {
      bg: "bg-bg-elevated",
      border: "border-border-subtle",
      fg: "text-text-secondary",
    },
    hover: {
      bg: "bg-bg-panel",
      border: "border-border-strong",
      fg: "text-text-primary",
    },
    pressed: {
      bg: "bg-bg-sunken",
      border: "border-border-strong",
      fg: "text-text-primary",
    },
    disabled: {
      bg: "bg-bg-sunken",
      border: "border-border-hairline",
      fg: "text-text-disabled",
    },
  },
};

/** Live hover/pressed driven by :hover/:active. Disabled is opt-in via prop. */
const LIVE_TRANSITIONS: Record<ButtonKind, string> = {
  primary:
    "hover:bg-accent-hover hover:border-accent-hover active:bg-accent-pressed active:border-accent-pressed",
  secondary:
    "hover:bg-bg-panel hover:border-border-strong active:bg-bg-sunken active:border-border-strong",
  icon:
    "hover:bg-bg-panel hover:border-border-strong hover:text-text-primary active:bg-bg-sunken active:border-border-strong",
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
  // If `disabled` is true (HTML prop), force the disabled visual state.
  const effectiveState: ButtonState = disabled ? "disabled" : state ?? "default";
  const styles = STYLES[kind][effectiveState];
  const useLiveStates = !disabled && state === undefined;

  const isIconOnly = kind === "icon" && !children;
  const sizeClass = isIconOnly ? "w-8 h-8 px-0" : "h-8 px-4";

  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled}
      className={clsx(
        "rounded-md border font-sans text-sm font-medium",
        "inline-flex items-center justify-center gap-2",
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
