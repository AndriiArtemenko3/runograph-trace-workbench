import clsx from "clsx";

/**
 * EV decomposition table — right-pane table that breaks the composite
 * EV score into its weighted signal contributions.
 *
 * Bit-locked to Figma master 17:31 (page 02 Components v2). Canon
 * dimensions: 440 wide × auto, rounded-lg, bg-panel, border-hairline.
 * In the live Solver Grid right pane (360 wide) the table renders at
 * `w-full` so its columns reflow inside the available width — Signal
 * column is fluid (1fr), Weight column is 44 px, Contribution is
 * 88 px right-aligned.
 *
 * Each row carries a `tone` derived from the contribution sign — the
 * canon reserves heat-tile fills for the matrix (productivity / pollution)
 * and uses status/success + status/danger for the contributions column,
 * so this component does NOT pull heat-* tokens.
 *
 * Row alternation: odd rows = bg-elevated, even rows = bg-panel — gives
 * a subtle zebra read across 8 rows. Header is bg-sunken; footer (the
 * composite total) is also bg-sunken with Inter Semi-Bold + status-success
 * for the positive composite.
 */

export interface EVDecompositionRow {
  signal: string;
  weight: string;
  contribution: string;
  /** "success" = positive contribution (green), "danger" = negative (red). */
  tone: "success" | "danger";
}

export interface EVDecompositionTableProps {
  rows: EVDecompositionRow[];
  /** Composite footer — e.g. `harness="Harness B"`, `value="+0.520"`. */
  harness: string;
  composite: string;
  compositeTone?: "success" | "danger";
  className?: string;
}

export function EVDecompositionTable({
  rows,
  harness,
  composite,
  compositeTone = "success",
  className,
}: EVDecompositionTableProps) {
  return (
    <section
      aria-label="EV decomposition"
      className={clsx(
        "rounded-lg bg-bg-panel border border-border-hairline overflow-hidden",
        "flex flex-col",
        className,
      )}
      data-canon="evdecomp-17:31"
    >
      <div
        className={clsx(
          "grid grid-cols-[1fr_44px_88px] gap-3",
          "px-3.5 py-2.5",
          "bg-bg-sunken",
          "text-text-secondary text-2xs font-medium uppercase tracking-wide",
        )}
        role="row"
      >
        <span className="font-sans" role="columnheader">
          Signal
        </span>
        <span className="font-mono text-right" role="columnheader">
          Weight
        </span>
        <span className="font-mono text-right" role="columnheader">
          Contribution
        </span>
      </div>
      <div role="rowgroup">
        {rows.map((r, i) => (
          <div
            key={r.signal}
            role="row"
            className={clsx(
              "grid grid-cols-[1fr_44px_88px] gap-3 items-center",
              "px-3.5 py-2",
              "text-sm",
              i % 2 === 0 ? "bg-bg-elevated" : "bg-bg-panel",
            )}
          >
            <span
              role="cell"
              className="font-sans text-text-primary truncate"
              title={r.signal}
            >
              {r.signal}
            </span>
            <span
              role="cell"
              className="font-mono text-text-secondary text-right tabular-nums"
            >
              {r.weight}
            </span>
            <span
              role="cell"
              className={clsx(
                "font-mono font-medium text-right tabular-nums",
                r.tone === "success" ? "text-status-success" : "text-status-danger",
              )}
            >
              {r.contribution}
            </span>
          </div>
        ))}
      </div>
      <div
        role="row"
        className={clsx(
          "grid grid-cols-[1fr_88px] gap-3 items-center",
          "px-3.5 py-3",
          "bg-bg-sunken",
          "border-t border-border-hairline",
        )}
      >
        <span
          role="cell"
          className="font-sans text-sm font-semibold text-text-primary truncate"
          title={`Composite EV · ${harness}`}
        >
          Composite EV · {harness}
        </span>
        <span
          role="cell"
          className={clsx(
            "font-mono text-sm font-medium text-right tabular-nums",
            compositeTone === "success" ? "text-status-success" : "text-status-danger",
          )}
        >
          {composite}
        </span>
      </div>
    </section>
  );
}
