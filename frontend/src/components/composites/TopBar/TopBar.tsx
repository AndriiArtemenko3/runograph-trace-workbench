import clsx from "clsx";
import { Button } from "../../Button";
import { ViewSwitcher, type SolverView } from "../../ViewSwitcher";

/**
 * Top-bar composite — the chrome row at the top of every solver page.
 *
 * Reuses Button + ViewSwitcher atoms; renders a weight-profile pill
 * chip pulled from the active solver weight preset. The full
 * WeightProfileSelector card is a different component (it opens in a
 * popover when this chip is clicked — popover behavior lands later).
 *
 * Canon h=56 (Figma 125:2 instance on page 03 Solver Grid v2).
 */

export interface TopBarProps {
  brand?: string;
  /** Crumbs displayed after the brand, e.g. \"/ 03 Solver Grid\". */
  crumb?: string;
  /** Selected weight-profile preset name (rendered as a compact chip). */
  weightProfile: string;
  activeView: SolverView;
  onViewChange?: (view: SolverView) => void;
  onWeightProfileClick?: () => void;
  onRunSim?: () => void;
  className?: string;
}

export function TopBar({
  brand = "RunoGraph",
  crumb,
  weightProfile,
  activeView,
  onViewChange,
  onWeightProfileClick,
  onRunSim,
  className,
}: TopBarProps) {
  return (
    <header
      className={clsx(
        "h-14 shrink-0 flex items-center justify-between",
        "px-4 gap-3",
        "bg-bg-panel border-b border-border-hairline",
        className,
      )}
      data-canon="topbar-31:4"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-sans text-md font-medium text-text-primary">
          {brand}
        </span>
        {crumb ? (
          <span className="text-text-secondary font-mono text-xs truncate">
            {crumb}
          </span>
        ) : null}
      </div>

      <ViewSwitcher active={activeView} onSelect={onViewChange} />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onWeightProfileClick}
          className={clsx(
            "h-8 px-3 rounded-md border border-border-hairline bg-bg-elevated",
            "font-sans text-sm font-medium text-text-secondary",
            "hover:text-text-primary hover:bg-bg-panel transition-colors",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-primary",
            "max-w-[200px] truncate inline-flex items-center gap-2",
          )}
        >
          <span className="text-text-secondary uppercase tracking-wide text-2xs">
            Weight
          </span>
          <span className="text-text-primary">{weightProfile}</span>
        </button>
        <Button kind="primary" onClick={onRunSim}>
          Run Sim
        </Button>
      </div>
    </header>
  );
}
