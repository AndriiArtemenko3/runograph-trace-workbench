import type { Meta, StoryObj } from "@storybook/react";
import { EVCell, type EVMagnitude, type EVSign } from "./EVCell";

const MAGS: EVMagnitude[] = [1, 2, 3, 4, 5];
const SIGNS: EVSign[] = ["positive", "negative"];

const EV_VALUE_BY_MAG: Record<EVMagnitude, string> = {
  1: "0.012",
  2: "0.045",
  3: "0.118",
  4: "0.247",
  5: "0.412",
};

const meta: Meta<typeof EVCell> = {
  title: "Atoms / EV-cell",
  component: EVCell,
  parameters: {
    docs: {
      description: {
        component: `Matrix-cell EV value.

Variants: \`sign\` (positive/negative) × \`magnitude\` (1-5) = 10. Used in the
EV matrix on the Solver Grid. Winner cell gets a 2px \`status/warning\` gold ring.

Bit-locked to Figma component **EV-cell** (id 13:51): 120×48, radius/md,
padTRBL [6,8,6,8], VERTICAL auto-layout, label-on-top + numeric-below.
Numeric is **JetBrains Mono Medium 14px**, label is **Inter Regular 10px**.

Text-on-fill contrast rule: magnitudes 1-2 use \`bg/canvas\` text on the light
heat fills; magnitudes 3-5 use \`text/primary\` for BOTH label and numeric.`,
      },
    },
  },
  argTypes: {
    sign: { control: "select", options: SIGNS },
    magnitude: { control: "select", options: MAGS },
    label: { control: "text" },
    value: { control: "text" },
    winner: { control: "boolean" },
  },
};
export default meta;

type Story = StoryObj<typeof EVCell>;

export const Default: Story = {
  args: {
    sign: "positive",
    magnitude: 4,
    label: "MAG 4",
    value: "+0.247",
  },
};

/** All 10 variants — canonical 2×5 grid matching the Figma component-library page. */
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
              label={`MAG ${mag}`}
              value={`${sign === "positive" ? "+" : "-"}${EV_VALUE_BY_MAG[mag]}`}
            />
          )),
        )}
      </div>
    </div>
  ),
};

/** A 4-column EV matrix as it appears in the Solver Grid (Harness B wins gold ring). */
export const SolverGridRow: Story = {
  render: () => (
    <div className="bg-bg-canvas border border-border-hairline rounded-xl p-6">
      <div className="grid grid-cols-4 gap-3">
        <EVCell sign="positive" magnitude={2} label="Harness A" value="+0.20" />
        <EVCell sign="positive" magnitude={4} label="Harness B" value="+0.52" winner />
        <EVCell sign="negative" magnitude={1} label="Harness C" value="−0.01" />
        <EVCell sign="negative" magnitude={3} label="Harness D" value="−0.30" />
      </div>
    </div>
  ),
};

export const Winner: Story = {
  args: { sign: "positive", magnitude: 4, label: "Harness B", value: "+0.52", winner: true },
};

export const NegativeDeep: Story = {
  args: { sign: "negative", magnitude: 5, label: "regressor", value: "−0.62" },
};
