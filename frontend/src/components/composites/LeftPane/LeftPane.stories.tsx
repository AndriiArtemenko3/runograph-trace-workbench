import type { Meta, StoryObj } from "@storybook/react";
import { LeftPane } from "./LeftPane";

const meta: Meta<typeof LeftPane> = {
  title: "Composites / Left-pane",
  component: LeftPane,
  parameters: {
    docs: {
      description: {
        component: `Left navigation rail — Harnesses, Stages, Configs. Reuses TreeNode atoms; one selected row gets the 3-px accent edge.`,
      },
    },
    layout: "fullscreen",
  },
};
export default meta;

type Story = StoryObj<typeof LeftPane>;

export const Default: Story = {
  args: {
    sections: [
      {
        title: "Harnesses",
        rows: [
          { label: "single-sonnet", value: "+0.20" },
          { label: "haiku-triage → sonnet-edit", value: "+0.52", selected: true },
          { label: "haiku-only", value: "−0.11" },
          { label: "sonnet + 3-retry repair", value: "+0.34" },
        ],
      },
      {
        title: "Stages",
        rows: [
          { label: "plan", value: "+0.04" },
          { label: "search", value: "+0.07" },
          { label: "edit", value: "+0.31", selected: true },
          { label: "test", value: "+0.06" },
          { label: "review", value: "+0.04" },
        ],
      },
    ],
  },
  decorators: [
    (S) => (
      <div className="h-[900px] bg-bg-canvas flex">
        <S />
      </div>
    ),
  ],
};
