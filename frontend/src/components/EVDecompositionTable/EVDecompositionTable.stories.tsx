import type { Meta, StoryObj } from "@storybook/react";
import { EVDecompositionTable } from "./EVDecompositionTable";

const CANON_ROWS = [
  { signal: "Human quality", weight: "0.25", contribution: "+0.220", tone: "success" as const },
  { signal: "Test pass rate", weight: "0.15", contribution: "+0.141", tone: "success" as const },
  { signal: "Route efficiency", weight: "0.10", contribution: "+0.078", tone: "success" as const },
  { signal: "Reliability", weight: "0.15", contribution: "+0.132", tone: "success" as const },
  { signal: "Cost", weight: "0.10", contribution: "−0.022", tone: "danger" as const },
  { signal: "Latency", weight: "0.10", contribution: "−0.014", tone: "danger" as const },
  { signal: "Regression risk", weight: "0.10", contribution: "−0.010", tone: "danger" as const },
  { signal: "Human correction", weight: "0.05", contribution: "−0.005", tone: "danger" as const },
];

const meta: Meta<typeof EVDecompositionTable> = {
  title: "Atoms / EV decomposition table",
  component: EVDecompositionTable,
  parameters: {
    docs: {
      description: {
        component: `Right-pane table that breaks the composite EV score into its 8 weighted signal contributions.

Bit-locked to Figma master 17:31 (page 02 Components v2). The 8 signal terms — Human quality / Test pass rate / Route efficiency / Reliability / Cost / Latency / Regression risk / Human correction — match the locked composite formula in the Q3 strategy (\`+ quality + tests + efficiency + reliability − cost − latency − regression − correction\`).

Row alternation = bg-elevated / bg-panel. Header + footer = bg-sunken. Contribution column reserves status-success / status-danger for the sign tint — heat-tile fills stay scoped to the matrix view.`,
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof EVDecompositionTable>;

export const Default: Story = {
  args: {
    rows: CANON_ROWS,
    harness: "Harness B",
    composite: "+0.520",
    compositeTone: "success",
  },
  decorators: [
    (S) => (
      <div className="w-[440px]">
        <S />
      </div>
    ),
  ],
};

export const RightPaneWidth: Story = {
  args: {
    rows: CANON_ROWS,
    harness: "Harness B",
    composite: "+0.520",
  },
  decorators: [
    (S) => (
      <div className="bg-bg-canvas p-4 w-[360px]">
        <S />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          "Real-use width — 360 px right pane minus 16 px each side = 328 px. The Signal column reflows; the Weight + Contribution columns stay fixed at 44 / 88 px.",
      },
    },
  },
};

export const NegativeComposite: Story = {
  args: {
    rows: CANON_ROWS.map((r) => ({ ...r, tone: r.tone === "success" ? "danger" : "success" })),
    harness: "Harness C",
    composite: "−0.110",
    compositeTone: "danger",
  },
  decorators: [
    (S) => (
      <div className="w-[440px]">
        <S />
      </div>
    ),
  ],
  parameters: {
    docs: { description: { story: "Demonstrates the danger-tone composite when the harness lost vs baseline." } },
  },
};
