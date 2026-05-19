import clsx from "clsx";
import { Button } from "../components/Button";
import { EVCell, type EVSign, type EVMagnitude } from "../components/EVCell";

/**
 * Solver Grid page — Path B commit 1 + iter-2 reshape.
 *
 * Layout target: Figma file OvWgOsrPH5t3hL4l5bIazx page "03 Solver Grid v2"
 * (root node 31:3). Three-pane body — 320 left / 760 center / 360 right —
 * with a 56px top chrome and 36px bottom status bar.
 *
 * Iter-2 reshape: the center pane now ships three stacked sections to match
 * canon — Harness-summary row (4 cards) → Per-task EV detail matrix →
 * Failure-class breakdown — instead of a single 4×5 EV-matrix block.
 *
 * Components in this page:
 *   - Real:   Button, EVCell
 *   - Stub:   TreeNode (left pane rows),       Figma master 14:55  → commit 2
 *             Harness summary cards (top),     Figma master 31:9   → composite (lands as part of commit 10 TopBar/composite work)
 *             Failure-class breakdown,         Figma master 34:38  → later
 *             Recommendation pill (top right), Figma master 22:14  → commit 6
 *             EV decomposition table (mid),    Figma master 24:10  → commit 7
 *             Stage-decomposition table,       Figma master 35:58  → derived from commit 5 atoms
 *             Status-bar entry (bottom),       Figma master 27:33  → commit 4
 *             Weight-profile selector (top),   Figma master 29:18  → commit 9
 *
 * Each stub keeps the canon position + footprint so swap-in is a one-line edit.
 */

type Harness = {
  id: "A" | "B" | "C" | "D";
  name: string;
  ev: string;
  evSign: EVSign;
  evMagnitude: EVMagnitude;
  winner?: boolean;
  cells: { label: string; value: string; sign: EVSign; magnitude: EVMagnitude }[];
};

const MOCK_HARNESSES: Harness[] = [
  {
    id: "A",
    name: "single-sonnet",
    ev: "+0.20",
    evSign: "positive",
    evMagnitude: 2,
    cells: [
      { label: "T1", value: "+0.18", sign: "positive", magnitude: 2 },
      { label: "T2", value: "+0.24", sign: "positive", magnitude: 3 },
      { label: "T3", value: "−0.08", sign: "negative", magnitude: 1 },
      { label: "T4", value: "+0.31", sign: "positive", magnitude: 4 },
      { label: "T5", value: "+0.15", sign: "positive", magnitude: 2 },
    ],
  },
  {
    id: "B",
    name: "haiku-triage → sonnet-edit",
    ev: "+0.52",
    evSign: "positive",
    evMagnitude: 5,
    winner: true,
    cells: [
      { label: "T1", value: "+0.41", sign: "positive", magnitude: 4 },
      { label: "T2", value: "+0.62", sign: "positive", magnitude: 5 },
      { label: "T3", value: "+0.28", sign: "positive", magnitude: 3 },
      { label: "T4", value: "+0.57", sign: "positive", magnitude: 5 },
      { label: "T5", value: "+0.49", sign: "positive", magnitude: 4 },
    ],
  },
  {
    id: "C",
    name: "haiku-only",
    ev: "−0.11",
    evSign: "negative",
    evMagnitude: 2,
    cells: [
      { label: "T1", value: "−0.04", sign: "negative", magnitude: 1 },
      { label: "T2", value: "+0.08", sign: "positive", magnitude: 1 },
      { label: "T3", value: "−0.22", sign: "negative", magnitude: 3 },
      { label: "T4", value: "−0.14", sign: "negative", magnitude: 2 },
      { label: "T5", value: "−0.06", sign: "negative", magnitude: 1 },
    ],
  },
  {
    id: "D",
    name: "sonnet + 3-retry repair",
    ev: "+0.34",
    evSign: "positive",
    evMagnitude: 3,
    cells: [
      { label: "T1", value: "+0.29", sign: "positive", magnitude: 3 },
      { label: "T2", value: "+0.41", sign: "positive", magnitude: 4 },
      { label: "T3", value: "+0.12", sign: "positive", magnitude: 2 },
      { label: "T4", value: "+0.38", sign: "positive", magnitude: 4 },
      { label: "T5", value: "+0.22", sign: "positive", magnitude: 3 },
    ],
  },
];

const TASK_COLUMNS = ["T1", "T2", "T3", "T4", "T5"];

function PlaceholderBox({
  label,
  figmaId,
  className,
  bodyExtra,
  compact = false,
}: {
  label: string;
  figmaId: string;
  className?: string;
  bodyExtra?: string;
  /** Compact: single-line label only, no figma-marker line, truncates. */
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-md border border-dashed border-border-subtle",
        "bg-bg-elevated p-3",
        "text-text-secondary text-xs font-mono",
        compact && "p-2 flex items-center min-w-0",
        className,
      )}
      data-stub={figmaId}
    >
      {compact ? (
        <span
          className="block truncate text-text-secondary text-xs uppercase tracking-wide"
          title={label}
        >
          {label}
        </span>
      ) : (
        <>
          <div className="text-text-secondary text-xs uppercase tracking-wide mb-1">
            {label}
          </div>
          <div className="text-text-secondary">
            stub · Figma {figmaId}
            {bodyExtra ? ` · ${bodyExtra}` : null}
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="pb-2">
      <h3 className="font-sans text-sm font-medium text-text-primary uppercase tracking-wide">
        {title}
      </h3>
      {subtitle ? (
        <p className="text-text-secondary text-xs mt-1">{subtitle}</p>
      ) : null}
    </div>
  );
}

function ViewSwitcher() {
  const views: { id: string; label: string; active?: boolean }[] = [
    { id: "matrix", label: "Matrix", active: true },
    { id: "heatmap", label: "Heat-map" },
    { id: "stagetree", label: "Stage-tree" },
    { id: "editor", label: "Editor" },
  ];
  return (
    <div
      className="flex items-center bg-bg-elevated border border-border-hairline rounded-md p-0.5"
      role="tablist"
      aria-label="Solver views"
    >
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={v.active ?? false}
          className={clsx(
            // h-8 = 32 px (Tailwind default). Project spacing token 7 = 48 px,
            // so h-7 here would have ballooned the bar — use the default
            // Tailwind scale for chrome-row heights.
            "h-8 px-3 rounded-sm font-sans text-base font-medium",
            "transition-colors",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-primary",
            v.active
              ? "bg-accent-primary text-bg-canvas"
              : "text-text-secondary hover:text-text-primary",
          )}
          data-view={v.id}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function TopBar() {
  return (
    <header
      className={clsx(
        // Canon h=56 (Figma 125:2).
        "h-14 shrink-0 flex items-center justify-between",
        "px-4 gap-3",
        "bg-bg-panel border-b border-border-hairline",
      )}
      data-canon="topbar-31:4"
    >
      <div className="flex items-center gap-2">
        <span className="font-sans text-md font-medium text-text-primary">
          RunoGraph
        </span>
        <span className="text-text-secondary font-mono text-xs">
          / 03 Solver Grid
        </span>
      </div>

      <ViewSwitcher />

      <div className="flex items-center gap-2">
        <PlaceholderBox
          label="Weight: balanced"
          figmaId="29:18"
          className="h-8 w-40"
          compact
        />
        <Button kind="primary">Run Sim</Button>
      </div>
    </header>
  );
}

function LeftPane() {
  const sections: { title: string; rows: string[] }[] = [
    { title: "Harnesses", rows: MOCK_HARNESSES.map((h) => h.name) },
    { title: "Stages", rows: ["plan", "search", "edit", "test", "review"] },
  ];
  return (
    <aside
      aria-label="Harnesses and stages"
      className={clsx(
        "w-[320px] shrink-0",
        "bg-bg-panel border-r border-border-hairline",
        "flex flex-col",
      )}
      data-canon="leftpane-31:5"
    >
      {sections.map((s, idx) => (
        <div key={s.title} className={clsx("px-4", idx === 0 ? "pt-4" : "pt-4")}>
          <div className="pb-2 text-text-secondary text-xs uppercase tracking-wide">
            {s.title}
          </div>
          <div className="flex flex-col gap-1">
            {s.rows.map((r) => (
              <PlaceholderBox
                key={r}
                label={r}
                figmaId="14:55"
                className="h-9"
                compact
              />
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}

function HarnessSummaryRow() {
  const ci: Record<Harness["id"], string> = {
    A: "±0.04",
    B: "±0.03",
    C: "±0.05",
    D: "±0.06",
  };
  return (
    <section aria-label="Harness summary">
      <h3 className="sr-only">Harness summary</h3>
      <div className="grid grid-cols-4 gap-3">
        {MOCK_HARNESSES.map((h) => (
          <article
            key={h.id}
            className={clsx(
              "rounded-md p-4 flex flex-col gap-2",
              "bg-bg-panel border border-border-hairline",
              h.winner && "ring-2 ring-inset ring-status-warning",
            )}
            data-canon="harness-summary-31:9"
            data-harness={h.id}
          >
            <div className="flex items-center justify-between">
              <span className="font-sans text-xl font-medium text-text-primary">
                {h.id}
              </span>
              {h.winner ? (
                <span
                  className="font-mono text-2xs uppercase tracking-wide text-status-warning"
                  aria-label="winner"
                >
                  ◆ winner
                </span>
              ) : null}
            </div>
            <div
              className={clsx(
                "font-mono text-2xl font-medium tabular-nums leading-tight",
                h.evSign === "positive"
                  ? "text-heat-productivity-500"
                  : "text-heat-pollution-500",
              )}
            >
              {h.ev}
            </div>
            <div className="text-text-secondary text-2xs font-mono">
              95% CI {ci[h.id]}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PerTaskMatrix() {
  return (
    <div>
      <SectionHeader
        title="Per-task EV detail"
        subtitle="5 SWE-bench-lite bug-fix tasks · weight profile default"
      />
      <div className="overflow-auto">
        <table className="border-separate border-spacing-y-2">
          <thead>
            <tr>
              <th className="w-[180px] text-left text-text-secondary text-xs font-normal uppercase tracking-wide pl-1 pb-2">
                Harness
              </th>
              {TASK_COLUMNS.map((t) => (
                <th
                  key={t}
                  className="w-[120px] text-center text-text-secondary text-xs font-normal uppercase tracking-wide pb-2"
                >
                  {t}
                </th>
              ))}
              <th className="w-[80px] text-right text-text-secondary text-xs font-normal uppercase tracking-wide pr-0 pb-2">
                EV
              </th>
            </tr>
          </thead>
          <tbody>
            {MOCK_HARNESSES.map((h) => (
              <tr key={h.id}>
                <td
                  className={clsx(
                    "pl-1 pr-3 align-middle font-mono text-sm",
                    h.winner ? "text-text-primary" : "text-text-secondary",
                  )}
                >
                  {h.name}
                </td>
                {h.cells.map((c, i) => (
                  <td key={i} className="px-1 align-middle">
                    <EVCell
                      label={c.label}
                      value={c.value}
                      sign={c.sign}
                      magnitude={c.magnitude}
                      winner={h.winner && i === 1}
                    />
                  </td>
                ))}
                <td
                  className={clsx(
                    "pl-3 pr-0 text-right font-mono text-md tabular-nums",
                    h.winner ? "text-text-primary font-medium" : "text-text-secondary",
                  )}
                >
                  {h.ev}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CenterPane() {
  return (
    <section
      className="flex-1 min-w-0 bg-bg-canvas flex flex-col"
      data-canon="centerpane-31:6"
    >
      <div className="px-4 pt-4 pb-3">
        <h2 className="font-sans text-lg font-medium text-text-primary">
          Multi-harness solver · bug-fix task class
        </h2>
        <p className="text-text-secondary text-sm">
          4 harnesses × 1,200 sims each · 95% CI ·{" "}
          <span className="text-text-primary">iter 7,412 of 12,000</span>
        </p>
      </div>

      <div className="px-4 pb-4 flex flex-col gap-4 overflow-auto">
        <HarnessSummaryRow />
        <PerTaskMatrix />
        <PlaceholderBox
          label="Failure-class breakdown"
          figmaId="34:38"
          className="h-44 p-3"
          bodyExtra="orphan-loop / skip-load-bearing / context-overflow / citation-no-trav / under-connected × A B C D"
        />
      </div>
    </section>
  );
}

function RightPane() {
  return (
    <aside
      aria-label="Recommendation and decomposition"
      className={clsx(
        "w-[360px] shrink-0",
        "bg-bg-panel border-l border-border-hairline",
        "flex flex-col gap-3 p-4",
      )}
      data-canon="rightpane-31:7"
    >
      {/* Canon proportions: Recommendation ≈ 197, EV decomp ≈ 609 (dominant),
          Stage decomp small. h-32 + flex-1 + h-16 approximates 0.22 / 0.67 /
          0.11 of the pane height — matches canon within rounding. */}
      <PlaceholderBox
        label="Recommendation"
        figmaId="22:14"
        className="h-32 p-3"
      />
      <PlaceholderBox
        label="EV decomposition"
        figmaId="24:10"
        className="flex-1 min-h-[240px] p-3"
      />
      <PlaceholderBox
        label="Stage decomposition"
        figmaId="35:58"
        className="h-16 p-3"
      />
      <div className="flex gap-2 mt-auto">
        <Button kind="primary">Promote B</Button>
        <Button kind="secondary">Compare B vs A</Button>
        <Button kind="secondary">Export</Button>
      </div>
    </aside>
  );
}

function BottomBar() {
  const left = [
    { label: "vLLM", dot: "bg-status-info" },
    { label: "Queue", dot: "bg-status-info" },
    { label: "Sim", dot: "bg-status-info" },
  ];
  const right = [
    { label: "workers", dot: "bg-status-success" },
    { label: "p50/p95", dot: "bg-status-success" },
    { label: "v0.3-alpha", dot: "bg-status-success" },
  ];
  const Entry = ({ label, dot }: { label: string; dot: string }) => (
    <div
      className="flex items-center gap-2 text-text-secondary text-xs font-mono"
      data-stub="27:33"
    >
      <span className={clsx("h-2 w-2 rounded-full", dot)} />
      <span className="text-text-primary">{label}</span>
      <span>stub</span>
    </div>
  );
  return (
    <footer
      className={clsx(
        "h-9 shrink-0 flex items-center justify-between",
        "px-4",
        "bg-bg-panel border-t border-border-hairline",
      )}
      data-canon="bottombar-31:8"
    >
      <div className="flex items-center gap-4">
        {left.map((e) => (
          <Entry key={e.label} {...e} />
        ))}
      </div>
      <div className="flex items-center gap-4">
        {right.map((e) => (
          <Entry key={e.label} {...e} />
        ))}
      </div>
    </footer>
  );
}

export function SolverGrid() {
  return (
    <div className="min-h-screen w-screen flex flex-col bg-bg-canvas text-text-primary">
      {/* Visually-hidden page heading anchors the landmark/heading tree. */}
      <h1 className="sr-only">RunoGraph Solver Grid</h1>
      <TopBar />
      <main className="flex-1 flex min-h-0">
        <LeftPane />
        <CenterPane />
        <RightPane />
      </main>
      <BottomBar />
    </div>
  );
}
