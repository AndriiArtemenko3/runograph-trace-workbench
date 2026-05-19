import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * Tree-node — one row inside the left-pane tree (Harnesses / Stages /
 * Configs / Recently-retired). Bit-locked to Figma master "Tree-node"
 * (id 14:55), 6 canonical variants:
 *
 *   state       × interaction
 *   collapsed     default                 (id 14:23) — bg/canvas, ▸ chevron
 *   collapsed     hover                   (id 14:28) — bg/elevated
 *   collapsed     selected                (id 14:33) — bg/elevated + 3px accent edge
 *   expanded      default                 (id 14:39) — bg/canvas, ▾ chevron
 *   expanded      hover                   (id 14:44) — bg/elevated
 *   expanded      selected                (id 14:49) — bg/elevated + 3px accent edge
 *
 * Canon dimensions: 280×36 (h-9, w-full inside a 320px pane minus 16px each
 * side), padding 12 px horizontal, 6 px gap between chevron/label/value.
 *
 * Typography (canon):
 *   - chevron:  11 px Inter Medium, text/primary
 *   - label:    13 px Inter Regular, text/primary
 *   - value:    12 px JetBrains Mono Medium, text/primary
 *
 * Selected state renders a 3-px accent-primary left edge as an absolutely-
 * positioned bar so the row content never shifts between unselected and
 * selected — predictable column alignment across the list.
 *
 * `depth` controls the left-padding indent (12 px per level on top of the
 * canon 12 px base inset). Live hover state is wired via :hover; the
 * explicit `interaction` prop is for Storybook + regression tests.
 */

export type TreeNodeState = "collapsed" | "expanded";
export type TreeNodeInteraction = "default" | "hover" | "selected";

export interface TreeNodeProps {
  label: string;
  /** Right-aligned EV / metric, e.g. "+0.247". Pass null to hide. */
  value?: string | null;
  /** Slotted icon — overrides the default chevron glyph. */
  icon?: ReactNode;
  state?: TreeNodeState;
  /** Force a visual state — for Storybook + regression tests. Live UI uses :hover. */
  interaction?: TreeNodeInteraction;
  /** Indent depth (multiplied by 12 px). 0 = top-level. */
  depth?: number;
  onClick?: () => void;
  className?: string;
}

const BG_BY_INTERACTION: Record<TreeNodeInteraction, string> = {
  default: "bg-bg-canvas",
  hover: "bg-bg-elevated",
  selected: "bg-bg-elevated",
};

export function TreeNode({
  label,
  value,
  icon,
  state = "collapsed",
  interaction = "default",
  depth = 0,
  onClick,
  className,
}: TreeNodeProps) {
  const isSelected = interaction === "selected";
  const useLiveHover = interaction === "default";
  const chevron = icon ?? (state === "expanded" ? "▾" : "▸");
  // Canon base inset is 12 px (`pl-3`). Depth adds 12 px per level.
  const indentPx = 12 + depth * 12;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={state === "expanded"}
      aria-current={isSelected ? "true" : undefined}
      className={clsx(
        "relative h-9 w-full flex items-center gap-1.5 pr-3",
        "rounded-sm text-left",
        "font-sans text-base text-text-primary",
        "transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-primary",
        BG_BY_INTERACTION[interaction],
        useLiveHover && "hover:bg-bg-elevated",
        className,
      )}
      style={{ paddingLeft: `${indentPx}px` }}
      data-state={state}
      data-interaction={interaction}
    >
      {isSelected ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 h-full w-[3px] bg-accent-primary"
        />
      ) : null}
      <span
        aria-hidden="true"
        className="font-sans text-xs font-medium leading-none text-text-primary shrink-0"
      >
        {chevron}
      </span>
      <span className="flex-1 min-w-0 truncate font-sans text-base font-normal leading-none text-text-primary">
        {label}
      </span>
      {value != null ? (
        <span className="shrink-0 font-mono text-sm font-medium leading-none tabular-nums text-text-primary">
          {value}
        </span>
      ) : null}
    </button>
  );
}
