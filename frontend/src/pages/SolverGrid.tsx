import clsx from "clsx";
import { Button } from "../components/Button";
import { EVCell } from "../components/EVCell";
import { TreeNode } from "../components/TreeNode";
import { useSolverGrid } from "../api/useSolverGrid";
import type { Harness, SolverGridResponse, StageRow } from "../api/types";

/**
 * Solver Grid page — Path B commit 1 + iter-2 reshape + commit-3 fetch wiring.
 *
 * Data: fetched from GET /api/v1/solver-grid via useSolverGrid(). The page
 * renders loading / error / ready states. Same canon layout as commit-1:
 * top chrome (56) + 320 / 760 / 360 panes + 36 footer.
 *
 * Components in this page:
 *   - Real:   Button, EVCell, TreeNode (12 + 10 + 6 variants in Storybook)
 *   - Stub:   Harness summary cards (top),     Figma master 31:9   → composite (lands as part of commit 10 TopBar/composite work)
 *             Failure-class breakdown,         Figma master 34:38  → later
 *             Recommendation pill (top right), Figma master 22:14  → commit 6
 *             EV decomposition table (mid),    Figma master 24:10  → commit 7
 *             Stage-decomposition table,       Figma master 35:58  → derived from commit 5 atoms
 *             Status-bar entry (bottom),       Figma master 27:33  → commit 4
 *             Weight-profile selector (top),   Figma master 29:18  → commit 9
 */

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

function TopBar({ weightProfile }: { weightProfile: string }) {
  return (
    <header
      className={clsx(
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
          label={`Weight: ${weightProfile}`}
          figmaId="29:18"
          className="h-8 w-40"
          compact
        />
        <Button kind="primary">Run Sim</Button>
      </div>
    </header>
  );
}

function LeftPane({
  harnesses,
  stages,
}: {
  harnesses: Harness[];
  stages: StageRow[];
}) {
  const harnessRows = harnesses.map((h) => ({
    label: h.name,
    value: h.ev,
    selected: h.winner,
  }));
  const stageRows = stages.map((s) => ({
    label: s.stage,
    value: s.ev,
    selected: s.selected,
  }));
  const sections = [
    { title: "Harnesses", rows: harnessRows },
    { title: "Stages", rows: stageRows },
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
              />
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}

function HarnessSummaryRow({ harnesses }: { harnesses: Harness[] }) {
  return (
    <section aria-label="Harness summary">
      <h3 className="sr-only">Harness summary</h3>
      <div className="grid grid-cols-4 gap-3">
        {harnesses.map((h) => (
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
              95% CI {h.ci}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PerTaskMatrix({ harnesses }: { harnesses: Harness[] }) {
  const taskLabels = harnesses[0]?.cells.map((c) => c.label) ?? [];
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
              {taskLabels.map((t) => (
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
            {harnesses.map((h) => (
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

function CenterPane({ data }: { data: SolverGridResponse }) {
  return (
    <section
      className="flex-1 min-w-0 bg-bg-canvas flex flex-col"
      data-canon="centerpane-31:6"
    >
      <div className="px-4 pt-4 pb-3">
        <h2 className="font-sans text-lg font-medium text-text-primary">
          Multi-harness solver · {data.taskClass} task class
        </h2>
        <p className="text-text-secondary text-sm">
          {data.harnesses.length} harnesses × {data.simsPerHarness.toLocaleString()} sims each · 95%
          CI ·{" "}
          <span className="text-text-primary">
            iter {data.iterComplete.toLocaleString()} of{" "}
            {data.iterTotal.toLocaleString()}
          </span>
        </p>
      </div>

      <div className="px-4 pb-4 flex flex-col gap-4 overflow-auto">
        <HarnessSummaryRow harnesses={data.harnesses} />
        <PerTaskMatrix harnesses={data.harnesses} />
        <PlaceholderBox
          label="Failure-class breakdown"
          figmaId="34:38"
          className="h-44 p-3"
          bodyExtra={data.failureClasses.map((f) => f.failureClass).join(" / ")}
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

function LoadingPane() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex-1 flex items-center justify-center text-text-secondary text-sm font-mono"
    >
      Loading solver grid…
    </div>
  );
}

function ErrorPane({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex-1 flex flex-col items-center justify-center gap-2 text-status-danger text-sm font-mono"
    >
      <div>Could not load solver grid.</div>
      <div className="text-text-tertiary text-xs">{message}</div>
    </div>
  );
}

export function SolverGrid() {
  const state = useSolverGrid();
  return (
    <div className="min-h-screen w-screen flex flex-col bg-bg-canvas text-text-primary">
      <h1 className="sr-only">RunoGraph Solver Grid</h1>
      <TopBar
        weightProfile={state.status === "ready" ? state.data.weightProfile : "balanced"}
      />
      <main className="flex-1 flex min-h-0">
        {state.status === "ready" ? (
          <>
            <LeftPane harnesses={state.data.harnesses} stages={state.data.stages} />
            <CenterPane data={state.data} />
            <RightPane />
          </>
        ) : state.status === "loading" ? (
          <LoadingPane />
        ) : (
          <ErrorPane message={state.error} />
        )}
      </main>
      <BottomBar />
    </div>
  );
}
