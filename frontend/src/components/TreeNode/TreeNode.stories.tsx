import type { Meta, StoryObj } from "@storybook/react";
import { TreeNode, type TreeNodeState, type TreeNodeInteraction } from "./TreeNode";

const STATES: TreeNodeState[] = ["collapsed", "expanded"];
const INTERACTIONS: TreeNodeInteraction[] = ["default", "hover", "selected"];

const meta: Meta<typeof TreeNode> = {
  title: "Atoms / Tree-node",
  component: TreeNode,
  parameters: {
    docs: {
      description: {
        component: `One row of the left-pane tree (Harnesses / Stages / Configs).

Variants: \`state\` (collapsed / expanded) × \`interaction\` (default / hover / selected) = 6.

Bit-locked to Figma master **Tree-node** (id 14:55). 280×36 canon, 12 px horizontal padding, 6 px gap, selected adds a 3 px accent-primary left edge as an absolutely-positioned bar so column alignment never shifts.`,
      },
    },
  },
  argTypes: {
    state: { control: "select", options: STATES },
    interaction: { control: "select", options: INTERACTIONS },
    depth: { control: { type: "number", min: 0, max: 4 } },
  },
};
export default meta;

type Story = StoryObj<typeof TreeNode>;

export const Default: Story = {
  args: {
    label: "agent.research.summarise",
    value: "+0.247",
    state: "collapsed",
    interaction: "default",
  },
  decorators: [
    (S) => (
      <div className="bg-bg-panel border border-border-hairline rounded-md w-[280px]">
        <S />
      </div>
    ),
  ],
};

/** Canonical 2×3 grid — state × interaction = 6 variants laid out like Figma master 14:55. */
export const All6Variants: Story = {
  render: () => (
    <div className="bg-bg-panel border border-border-hairline rounded-md p-3 flex flex-col gap-3 w-[336px]">
      {STATES.map((state) => (
        <div key={state}>
          <div className="text-text-tertiary text-xs font-mono uppercase tracking-wide pb-1">
            state · {state}
          </div>
          <div className="flex flex-col gap-1">
            {INTERACTIONS.map((interaction) => (
              <div key={interaction} className="flex flex-col">
                <span className="text-text-tertiary text-2xs font-mono pl-1 pb-0.5">
                  {interaction}
                </span>
                <TreeNode
                  label="agent.research.summarise"
                  value="+0.247"
                  state={state}
                  interaction={interaction}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  ),
};

export const Selected: Story = {
  args: {
    label: "haiku-triage → sonnet-edit",
    value: "+0.52",
    state: "collapsed",
    interaction: "selected",
  },
  decorators: [
    (S) => (
      <div className="bg-bg-panel border border-border-hairline rounded-md w-[280px]">
        <S />
      </div>
    ),
  ],
};

export const Nested: Story = {
  render: () => (
    <div className="bg-bg-panel border border-border-hairline rounded-md p-2 flex flex-col gap-px w-[320px]">
      <TreeNode label="harnesses" state="expanded" interaction="default" />
      <TreeNode label="single-sonnet" value="+0.20" depth={1} />
      <TreeNode
        label="haiku-triage → sonnet-edit"
        value="+0.52"
        depth={1}
        interaction="selected"
      />
      <TreeNode label="haiku-only" value="−0.11" depth={1} />
      <TreeNode label="sonnet + 3-retry" value="+0.34" depth={1} />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Real use: a 4-harness list under one expanded parent. The selected row gets the 3-px accent edge; siblings stay flush.",
      },
    },
  },
};
