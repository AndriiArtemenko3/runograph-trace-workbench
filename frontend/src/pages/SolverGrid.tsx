import clsx from "clsx";
import { Button } from "../components/Button";
import { EVCell, type EVSign, type EVMagnitude } from "../components/EVCell";

/**
 * Solver Grid page — Path B commit 1, the first page that renders real UI.
 *
 * Layout target: Figma file OvWgOsrPH5t3hL4l5bIazx page "03 Solver Grid v2"
 * (root node 31:3). Three-pane body — 320 left / center fluid / 400 right —
 * with a 48px top chrome and 36px bottom status bar.
 *
 * Components in this commit:
 *   - Real:   Button, EVCell (already ported, 12 + 10 variants in Storybook)
 *   - Stub:   TreeNode (left pane rows),       Figma master 14:55  → commit 2
 *             Recommendation pill (top right), Figma master 22:14  → commit 6
 *             EV decomposition table (mid),    Figma master 24:10  → commit 7
 *             Node-EV-cell (stage rows),       Figma master 19:88  → commit 5
 *             Status-bar entry (bottom),       Figma master 27:33  → commit 4
 *             Weight-profile selector (top),   Figma master 29:18  → commit 9
 *
 * Each stub keeps the canon position + footprint so swap-in is a one-line edit.
 */

type Harness = {
  id: string;
  name: string;
  ev: string;
  winner?: boolean;
  cells: { label: string; value: string; sign: EVSign; magnitude: EVMagnitude }[];
};

const MOCK_HARNESSES: Harness[] = [
  {
    id: "a",
    name: "single-sonnet",
    ev: "+0.20",
    cells: [
      { label: "T1", value: "+0.18", sign: "positive", magnitude: 2 },
      { label: "T2", value: "+0.24", sign: "positive", magnitude: 3 },
      { label: "T3", value: "−0.08", sign: "negative", magnitude: 1 },
      { label: "T4", value: "+0.31", sign: "positive", magnitude: 4 },
      { label: "T5", value: "+0.15", sign: "positive", magnitude: 2 },
    ],
  },
  {
    id: "b",
    name: "haiku-triage→sonnet-edit",
    ev: "+0.52",
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
    id: "c",
    name: "haiku-only",
    ev: "−0.11",
    cells: [
      { label: "T1", value: "−0.04", sign: "negative", magnitude: 1 },
      { label: "T2", value: "+0.08", sign: "positive", magnitude: 1 },
      { label: "T3", value: "−0.22", sign: "negative", magnitude: 3 },
      { label: "T4", value: "−0.14", sign: "negative", magnitude: 2 },
      { label: "T5", value: "−0.06", sign: "negative", magnitude: 1 },
    ],
  },
  {
    id: "d",
    name: "sonnet+3-retry-repair",
    ev: "+0.34",
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
}: {
  label: string;
  figmaId: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-md border border-dashed border-border-subtle",
        "bg-bg-elevated/40 p-3",
        "text-text-tertiary text-xs font-mono",
        className,
      )}
      data-stub={figmaId}
    >
      <div className="text-text-secondary text-xs uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className="text-text-tertiary">stub · Figma {figmaId}</div>
    </div>
  );
}

function TopBar() {
  return (
    <header
      className={clsx(
        "h-12 shrink-0 flex items-center justify-between",
        "px-4 gap-3",
        "bg-bg-panel border-b border-border-hairline",
      )}
      data-canon="topbar-31:4"
    >
      <div className="flex items-center gap-3">
        <span className="font-sans text-md font-medium text-text-primary">
          RunoGraph
        </span>
        <span className="text-text-tertiary font-mono text-xs">
          / 03 Solver Grid
        </span>
      </div>

      <div className="flex items-center gap-2">
        <PlaceholderBox
          label="Weight profile"
          figmaId="29:18"
          className="h-8 w-40 p-1 flex items-center"
        />
        <Button kind="secondary">Editor</Button>
        <Button kind="secondary">Heat-map</Button>
        <Button kind="primary">Run Sim</Button>
      </div>
    </header>
  );
}

function LeftPane() {
  return (
    <aside
      className={clsx(
        "w-[320px] shrink-0",
        "bg-bg-panel border-r border-border-hairline",
        "flex flex-col",
      )}
      data-canon="leftpane-31:5"
    >
      <div className="px-4 pt-4 pb-2 text-text-secondary text-xs uppercase tracking-wide">
        Harnesses
      </div>
      <div className="px-3 flex flex-col gap-1">
        {MOCK_HARNESSES.map((h) => (
          <PlaceholderBox
            key={h.id}
            label={h.name}
            figmaId="14:55"
            className="h-9 p-2 flex items-center"
          />
        ))}
      </div>
      <div className="px-4 pt-5 pb-2 text-text-secondary text-xs uppercase tracking-wide">
        Stages
      </div>
      <div className="px-3 flex flex-col gap-1">
        {["plan", "search", "edit", "test", "review"].map((s) => (
          <PlaceholderBox
            key={s}
            label={s}
            figmaId="14:55"
            className="h-9 p-2 flex items-center"
          />
        ))}
      </div>
    </aside>
  );
}

function CenterPane() {
  return (
    <section
      className="flex-1 min-w-0 bg-bg-canvas flex flex-col"
      data-canon="centerpane-31:6"
    >
      <div className="px-5 pt-5 pb-3">
        <h2 className="font-sans text-lg font-medium text-text-primary">
          EV matrix
        </h2>
        <p className="text-text-tertiary text-sm">
          4 harnesses · 5 SWE-bench-lite bug-fix tasks · weight profile{" "}
          <span className="text-text-secondary">default</span>
        </p>
      </div>

      <div className="px-5 pb-5 overflow-auto">
        <table className="border-separate border-spacing-y-2">
          <thead>
            <tr>
              <th className="w-[180px] text-left text-text-tertiary text-xs font-normal uppercase tracking-wide pl-1 pb-2">
                Harness
              </th>
              {TASK_COLUMNS.map((t) => (
                <th
                  key={t}
                  className="w-[120px] text-center text-text-tertiary text-xs font-normal uppercase tracking-wide pb-2"
                >
                  {t}
                </th>
              ))}
              <th className="w-[100px] text-right text-text-tertiary text-xs font-normal uppercase tracking-wide pr-1 pb-2">
                Composite
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
                    "pl-3 pr-1 text-right font-mono text-md tabular-nums",
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
    </section>
  );
}

function RightPane() {
  return (
    <aside
      className={clsx(
        "w-[400px] shrink-0",
        "bg-bg-panel border-l border-border-hairline",
        "flex flex-col gap-3 p-4",
      )}
      data-canon="rightpane-31:7"
    >
      <PlaceholderBox
        label="Recommendation"
        figmaId="22:14"
        className="h-16 p-3"
      />
      <PlaceholderBox
        label="EV decomposition"
        figmaId="24:10"
        className="flex-1 p-3"
      />
      <PlaceholderBox
        label="Stage decomposition"
        figmaId="19:88"
        className="h-48 p-3"
      />
    </aside>
  );
}

function BottomBar() {
  const entries = [
    { label: "vLLM", figmaId: "27:33" },
    { label: "Queue", figmaId: "27:33" },
    { label: "Sim", figmaId: "27:33" },
    { label: "DB", figmaId: "27:33" },
  ];
  return (
    <footer
      className={clsx(
        "h-9 shrink-0 flex items-center gap-4",
        "px-4",
        "bg-bg-panel border-t border-border-hairline",
      )}
      data-canon="bottombar-31:8"
    >
      {entries.map((e) => (
        <div
          key={e.label}
          className="flex items-center gap-2 text-text-tertiary text-xs font-mono"
          data-stub={e.figmaId}
        >
          <span className="h-2 w-2 rounded-full bg-status-info" />
          <span className="text-text-secondary">{e.label}</span>
          <span>stub · Figma {e.figmaId}</span>
        </div>
      ))}
    </footer>
  );
}

export function SolverGrid() {
  return (
    <div className="min-h-screen w-screen flex flex-col bg-bg-canvas text-text-primary">
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
