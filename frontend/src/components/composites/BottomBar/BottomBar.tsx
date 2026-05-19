import clsx from "clsx";
import { StatusEntry, type StatusTone } from "../../StatusEntry";

/**
 * Bottom-bar composite — the chrome row at the bottom of every solver
 * page. Reuses StatusEntry atoms split into a left infra cluster and a
 * right telemetry cluster.
 *
 * Canon h=36 (Figma 125:96 instance on page 03 Solver Grid v2),
 * bg-elevated + border-t border-hairline, px-5 (24 px) per canon.
 */

export interface BottomBarEntry {
  tone: StatusTone;
  label: string;
  detail?: string;
}

export interface BottomBarProps {
  left: BottomBarEntry[];
  right: BottomBarEntry[];
  className?: string;
}

export function BottomBar({ left, right, className }: BottomBarProps) {
  return (
    <footer
      className={clsx(
        "h-9 shrink-0 flex items-center justify-between",
        "px-5 gap-4",
        "bg-bg-elevated border-t border-border-hairline",
        className,
      )}
      data-canon="bottombar-31:8"
    >
      <div className="flex items-center gap-5 min-w-0">
        {left.map((e) => (
          <StatusEntry key={e.label} tone={e.tone} label={e.label} detail={e.detail} />
        ))}
      </div>
      <div className="flex items-center gap-5 min-w-0">
        {right.map((e) => (
          <StatusEntry key={e.label} tone={e.tone} label={e.label} detail={e.detail} />
        ))}
      </div>
    </footer>
  );
}
