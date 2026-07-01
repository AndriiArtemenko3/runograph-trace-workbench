import { Fragment } from "react";
import clsx from "clsx";
import { Button } from "../components/Button";
import { EVCell } from "../components/EVCell";
import { NodeEVCell } from "../components/NodeEVCell";
import { RecommendationPill } from "../components/RecommendationPill";
import { EVDecompositionTable } from "../components/EVDecompositionTable";
import { LeftPane, type LeftPaneSection } from "../components/composites/LeftPane";
import { type BottomBarEntry } from "../components/composites/BottomBar";
import { AppShell } from "./AppShell";
import { useSolverGrid } from "../api/useSolverGrid";
import type {
  EVDecomposition,
  Harness,
  Recommendation,
  SolverGridResponse,
  StageDecompRow,
} from "../api/types";

/**
 * Solver Grid page — Path B build sequence complete.
 *
 * Data: fetched from GET /api/v1/solver-grid via useSolverGrid(). The page
 * renders loading / error / ready states. Canon layout:
 *   top chrome (56) + 320 / 760 / 360 panes + 36 footer.
 *
 * Page now assembles entirely from real components:
 *   chrome   TopBar (composite) + ViewSwitcher (atom) + Button (atom)
 *   left     LeftPane (composite) + TreeNode (atom)
 *   center   HarnessSummaryRow + PerTaskMatrix (page-local sections)
 *            EVCell (atom) in the matrix; Failure-class still stubbed
 *   right    RecommendationPill (atom) + EVDecompositionTable (atom)
 *            + StageDecompositionTable (page-local section using NodeEVCell)
 *            + 3 Buttons (atoms)
 *   footer   BottomBar (composite) + StatusEntry (atom)
 *
 * Only the Failure-class breakdown ships as a stub — its real
 * component lands when the Heat-map page or Editor view need it
 * (deferred per the Q3 plan).
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

function StageDecompositionTable({ rows }: { rows: StageDecompRow[] }) {
  const harnessCols: Array<keyof Omit<StageDecompRow, "stage">> = ["a", "b", "c", "d"];
  return (
    <section
      aria-label="Stage decomposition"
      className="rounded-md bg-bg-elevated border border-border-hairline p-3"
      data-canon="stagedecomp-35:58"
    >
      <h3 className="text-text-secondary text-xs font-mono uppercase tracking-wide pb-2">
        Stage decomposition · EV by pipeline stage
      </h3>
      <div className="grid grid-cols-[1fr_repeat(4,64px)] gap-x-2 gap-y-1 items-center">
        <span className="text-text-secondary text-2xs font-mono uppercase tracking-wide">
          stage
        </span>
        {(["A", "B", "C", "D"] as const).map((h) => (
          <span
            key={h}
            className="text-text-secondary text-2xs font-mono text-center uppercase"
          >
            {h}
          </span>
        ))}
        {rows.map((r) => (
          <Fragment key={r.stage}>
            <span className="text-text-primary text-sm font-sans">{r.stage}</span>
            {harnessCols.map((c) => {
              const cell = r[c];
              return (
                <NodeEVCell
                  key={`${r.stage}-${c}`}
                  value={cell.value}
                  sign={cell.sign}
                  magnitude={cell.magnitude}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function RightPane({
  stageDecomposition,
  recommendation,
  evDecomposition,
}: {
  stageDecomposition: StageDecompRow[];
  recommendation: Recommendation;
  evDecomposition: EVDecomposition;
}) {
  return (
    <aside
      aria-label="Recommendation and decomposition"
      className={clsx(
        "w-[360px] shrink-0",
        "bg-bg-panel border-l border-border-hairline",
        "flex flex-col gap-3 p-4 overflow-y-auto",
      )}
      data-canon="rightpane-31:7"
    >
      <RecommendationPill
        kind="top-pick"
        harnessId={recommendation.topPick.harnessId}
        ev={recommendation.topPick.ev}
        descriptor={recommendation.topPick.descriptor}
        bullets={recommendation.topPick.bullets}
        className="w-full"
      />
      <EVDecompositionTable
        rows={evDecomposition.rows}
        harness={evDecomposition.harness}
        composite={evDecomposition.composite}
        compositeTone={evDecomposition.compositeTone}
      />
      <StageDecompositionTable rows={stageDecomposition} />
      <div className="flex gap-2 mt-auto pt-1">
        <Button kind="primary">Promote B</Button>
        <Button kind="secondary">Compare B vs A</Button>
        <Button kind="secondary">Export</Button>
      </div>
    </aside>
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

function buildLeftPaneSections(data: SolverGridResponse): LeftPaneSection[] {
  return [
    {
      title: "Harnesses",
      rows: data.harnesses.map((h) => ({
        label: h.name,
        value: h.ev,
        selected: h.winner,
      })),
    },
    {
      title: "Stages",
      rows: data.stages.map((s) => ({
        label: s.stage,
        value: s.ev,
        selected: s.selected,
      })),
    },
  ];
}

function buildBottomBarEntries(
  data: SolverGridResponse | null,
): { left: BottomBarEntry[]; right: BottomBarEntry[] } {
  const winner = data?.harnesses.find((h) => h.winner);
  const simsTotal = data
    ? `${data.iterComplete.toLocaleString()} / ${data.iterTotal.toLocaleString()}`
    : "—";
  return {
    left: [
      { tone: "info", label: "sims", detail: simsTotal },
      { tone: "info", label: "Ollama llama-70b", detail: "GPU 78% · 24GB / 80GB" },
      {
        tone: "success",
        label: winner ? `Top: Harness ${winner.id}` : "Top: —",
        detail: winner ? `${winner.ev} · 94% pass` : "",
      },
    ],
    right: [
      { tone: "success", label: "workers 8/8", detail: "p50 1.4s · p95 5.2s" },
      { tone: "success", label: "v0.3-alpha", detail: "14:22" },
    ],
  };
}

export function SolverGrid() {
  const state = useSolverGrid();
  const bottomEntries = buildBottomBarEntries(
    state.status === "ready" ? state.data : null,
  );
  return (
    <AppShell
      crumb="/ 03 Solver Grid"
      pageTitle="RunoGraph Solver Grid"
      weightProfile={state.status === "ready" ? state.data.weightProfile : "balanced"}
      bottomLeft={bottomEntries.left}
      bottomRight={bottomEntries.right}
    >
      {state.status === "ready" ? (
        <>
          <LeftPane sections={buildLeftPaneSections(state.data)} />
          <CenterPane data={state.data} />
          <RightPane
            stageDecomposition={state.data.stageDecomposition}
            recommendation={state.data.recommendation}
            evDecomposition={state.data.evDecomposition}
          />
        </>
      ) : state.status === "loading" ? (
        <LoadingPane />
      ) : (
        <ErrorPane message={state.error} />
      )}
    </AppShell>
  );
}
