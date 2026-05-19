import type { Meta, StoryObj } from "@storybook/react";
import { EVCell, type EVMagnitude, type EVSign } from "./EVCell";

const MAGS: EVMagnitude[] = [1, 2, 3, 4, 5];
const SIGNS: EVSign[] = ["positive", "negative"];

const EV_VALUE_BY_MAG: Record<EVMagnitude, string> = {
  1: "0.05",
  2: "0.18",
  3: "0.31",
  4: "0.44",
  5: "0.62",
};

const meta: Meta<typeof EVCell> = {
  title: "Atoms / EV-cell",
  component: EVCell,
  parameters: {
    docs: {
      description: {
        component: `Matrix-cell EV value.

Variants: \`sign\` (positive/negative) × \`magnitude\` (1-5) = 10. Used in the
4-column EV matrix of the Solver Grid. Winner cell gets 2px status-warning
gold border.

Bit-locked to Figma component **EV-cell** (id 13:51) — 120×48, radius/md.

Text-on-fill contrast rule from v2 redteam: magnitudes 1-2 use \`bg/canvas\`
text on the lighter heat fills; magnitudes 3-5 use \`text/primary\` on the
darker fills. This is what passes WCAG 4.5:1 across all variants.`,
      },
    },
  },
  argTypes: {
    sign: { control: "select", options: SIGNS },
    magnitude: { control: "select", options: MAGS },
    value: { control: "text" },
    caption: { control: "text" },
    winner: { control: "boolean" },
  },
};
export default meta;

type Story = StoryObj<typeof EVCell>;

export const Default: Story = {
  args: {
    sign: "positive",
    magnitude: 4,
    value: "+0.44",
    caption: "+EV · 50 runs",
  },
};

/** All 10 variants in canonical 2×5 grid. */
export const All10Variants: Story = {
  render: () => (
    <div className="bg-bg-panel border border-border-hairline rounded-xl p-4">
      <div className="grid grid-cols-5 gap-3">
        {SIGNS.flatMap((sign) =>
          MAGS.map((mag) => (
            <EVCell
              key={`${sign}-${mag}`}
              sign={sign}
              magnitude={mag}
              value={`${sign === "positive" ? "+" : "−"}${EV_VALUE_BY_MAG[mag]}`}
              caption={`mag ${mag}`}
            />
          )),
        )}
      </div>
    </div>
  ),
};

/** A 4-column EV matrix as it appears in the Solver Grid right pane (Harness B wins). */
export const SolverGridRow: Story = {
  render: () => (
    <div className="bg-bg-canvas border border-border-hairline rounded-xl p-6">
      <div className="grid grid-cols-4 gap-3">
        <EVCell sign="positive" magnitude={2} value="+0.20" caption="Harness A" />
        <EVCell sign="positive" magnitude={4} value="+0.52" caption="Harness B" winner />
        <EVCell sign="negative" magnitude={1} value="−0.01" caption="Harness C" />
        <EVCell sign="negative" magnitude={3} value="−0.30" caption="Harness D" />
      </div>
    </div>
  ),
};

export const Winner: Story = {
  args: {
    sign: "positive",
    magnitude: 4,
    value: "+0.52",
    caption: "Harness B",
    winner: true,
  },
};

export const NegativeDeep: Story = {
  args: { sign: "negative", magnitude: 5, value: "−0.62", caption: "regressor" },
};
