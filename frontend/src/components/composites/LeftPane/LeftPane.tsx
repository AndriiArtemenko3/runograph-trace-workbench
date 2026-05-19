import clsx from "clsx";
import { TreeNode } from "../../TreeNode";

/**
 * Left-pane composite — the navigation tree rail (Harnesses / Stages /
 * Configs / Recently-retired).
 *
 * Reuses TreeNode atoms. Each section gets an uppercase eyebrow header
 * + a vertical stack of rows. The selected flag on a row renders a
 * 3-px accent left edge inside the TreeNode atom.
 *
 * Canon w=320 (Figma 125:38 instance), bg-panel + border-r border-hairline.
 */

export interface LeftPaneRow {
  label: string;
  value?: string;
  selected?: boolean;
}

export interface LeftPaneSection {
  title: string;
  rows: LeftPaneRow[];
}

export interface LeftPaneProps {
  sections: LeftPaneSection[];
  className?: string;
  onRowClick?: (sectionTitle: string, label: string) => void;
}

export function LeftPane({ sections, className, onRowClick }: LeftPaneProps) {
  return (
    <aside
      aria-label="Left navigation pane"
      className={clsx(
        "w-[320px] shrink-0",
        "bg-bg-panel border-r border-border-hairline",
        "flex flex-col",
        className,
      )}
      data-canon="leftpane-31:5"
    >
      {sections.map((s) => (
        <div key={s.title} className="px-2 pt-4">
          <div className="px-2 pb-1 text-text-secondary text-xs uppercase tracking-wide">
            {s.title}
          </div>
          <div className="flex flex-col">
            {s.rows.map((r) => (
              <TreeNode
                key={r.label}
                label={r.label}
                value={r.value}
                interaction={r.selected ? "selected" : "default"}
                onClick={onRowClick ? () => onRowClick(s.title, r.label) : undefined}
              />
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}
