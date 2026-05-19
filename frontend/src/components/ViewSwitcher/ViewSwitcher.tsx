import clsx from "clsx";

/**
 * View-switcher — segmented control that swaps between Solver Grid views.
 *
 * Lives in the chrome top-bar. 4 segments (Matrix / Heat-map / Stage-tree
 * / Editor). The active segment renders bg-accent-primary + dark text
 * (the WCAG-revised contrast rule shared with the Button atom); inactive
 * segments are text-secondary with hover lift to text-primary.
 *
 * Bit-locked to Figma canon in page \"03 Solver Grid v2\" top-bar IA.
 */

export type SolverView = "matrix" | "heatmap" | "stagetree" | "editor";

export interface ViewSwitcherProps {
  active: SolverView;
  onSelect?: (view: SolverView) => void;
  className?: string;
}

const VIEWS: { id: SolverView; label: string }[] = [
  { id: "matrix", label: "Matrix" },
  { id: "heatmap", label: "Heat-map" },
  { id: "stagetree", label: "Stage-tree" },
  { id: "editor", label: "Editor" },
];

export function ViewSwitcher({ active, onSelect, className }: ViewSwitcherProps) {
  return (
    <div
      className={clsx(
        "flex items-center bg-bg-elevated border border-border-hairline rounded-md p-0.5",
        className,
      )}
      role="tablist"
      aria-label="Solver views"
    >
      {VIEWS.map((v) => {
        const isActive = v.id === active;
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect?.(v.id)}
            className={clsx(
              "h-8 px-3 rounded-sm font-sans text-base font-medium",
              "transition-colors",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-primary",
              isActive
                ? "bg-accent-primary text-bg-canvas"
                : "text-text-secondary hover:text-text-primary",
            )}
            data-view={v.id}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
