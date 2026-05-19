import type { Meta, StoryObj } from "@storybook/react";
import { HeatTile, type HeatLevel } from "./HeatTile";

const LEVELS: HeatLevel[] = ["low", "med", "high"];

const meta: Meta<typeof HeatTile> = {
  title: "Atoms / Heat-tile",
  component: HeatTile,
  parameters: {
    docs: {
      description: {
        component: `Atomic primitive — represents one corpus-map tile.

Variants: \`productivity\` (low/med/high) × \`pollution\` (low/med/high) = 9 fills.

Bit-locked to Figma component **Heat-tile** (id 13:20) — 32×32, radius/sm, border/hairline.`,
      },
    },
  },
  argTypes: {
    productivity: { control: "select", options: LEVELS },
    pollution: { control: "select", options: LEVELS },
  },
};
export default meta;

type Story = StoryObj<typeof HeatTile>;

export const Default: Story = {
  args: { productivity: "high", pollution: "low" },
};

/** The canonical 3×3 grid — all 9 variants laid out exactly as the Figma master. */
export const All9Variants: Story = {
  render: () => (
    <div className="bg-bg-panel border border-border-hairline rounded-xl p-4">
      <div className="grid grid-cols-[auto_repeat(3,32px)] gap-3 items-center">
        <span />
        {LEVELS.map((lvl) => (
          <span
            key={lvl}
            className="text-text-tertiary text-xs font-mono text-center"
          >
            P={lvl}
          </span>
        ))}
        {LEVELS.map((poll) => (
          <>
            <span
              key={`label-${poll}`}
              className="text-text-tertiary text-xs font-mono pr-2"
            >
              poll={poll}
            </span>
            {LEVELS.map((prod) => (
              <HeatTile key={`${prod}-${poll}`} productivity={prod} pollution={poll} />
            ))}
          </>
        ))}
      </div>
    </div>
  ),
};

export const HighProductivityLowPollution: Story = {
  args: { productivity: "high", pollution: "low" },
};

export const LowProductivityHighPollution: Story = {
  args: { productivity: "low", pollution: "high" },
};

export const Contested: Story = {
  args: { productivity: "high", pollution: "high" },
  parameters: {
    docs: { description: { story: "Warning yellow — high prod AND high poll = contested file." } },
  },
};
