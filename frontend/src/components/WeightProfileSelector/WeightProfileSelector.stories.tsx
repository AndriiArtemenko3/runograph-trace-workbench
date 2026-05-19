import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  WeightProfileSelector,
  WEIGHT_PROFILES,
  type WeightProfile,
} from "./WeightProfileSelector";

const meta: Meta<typeof WeightProfileSelector> = {
  title: "Atoms / Weight-profile selector",
  component: WeightProfileSelector,
  parameters: {
    docs: {
      description: {
        component: `Picker for the composite-EV weight preset that drives every harness comparison.

Variants: \`selected\` = one of 6 presets (Balanced / Startup / Enterprise / CI / Local-agent / Coding-labs). Bit-locked to Figma master 16:98 (page 02 Components v2). 560 wide bordered panel; pills are h-8 px-3 with bg-accent-primary on the selected one.

Dark text (bg-canvas) on the accent fill — the canon's white-on-accent reads ~2.5:1, the WCAG-revised dark-text rule from the Button atom applies here too.`,
      },
    },
  },
  argTypes: {
    selected: { control: "select", options: WEIGHT_PROFILES },
  },
};
export default meta;

type Story = StoryObj<typeof WeightProfileSelector>;

export const Default: Story = {
  args: { selected: "Balanced" },
  decorators: [
    (S) => (
      <div className="w-[560px] bg-bg-canvas p-4">
        <S />
      </div>
    ),
  ],
};

/** Canonical 6-row stack — one selector per preset. */
export const All6Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-3 p-4 bg-bg-canvas w-[592px]">
      {WEIGHT_PROFILES.map((p) => (
        <WeightProfileSelector key={p} selected={p} />
      ))}
    </div>
  ),
};

export const Interactive: Story = {
  render: () => {
    const [selected, setSelected] = useState<WeightProfile>("Balanced");
    return (
      <div className="w-[560px] bg-bg-canvas p-4">
        <WeightProfileSelector selected={selected} onSelect={setSelected} />
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Click a pill to flip the selection. Tab + Space / Enter cycle through via the radio-group semantics.",
      },
    },
  },
};
