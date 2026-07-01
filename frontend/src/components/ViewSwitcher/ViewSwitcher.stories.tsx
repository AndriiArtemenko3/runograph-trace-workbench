import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { ViewSwitcher, type SolverView } from "./ViewSwitcher";

const meta: Meta<typeof ViewSwitcher> = {
  title: "Atoms / View-switcher",
  component: ViewSwitcher,
  parameters: {
    docs: {
      description: {
        component: `Segmented control swapping between the four solver views (Routes / Heat-map / Stage-tree / Editor). Renders inside the chrome top-bar.`,
      },
    },
  },
  argTypes: {
    active: { control: "select", options: ["routes", "heatmap", "stagetree", "editor"] },
  },
};
export default meta;

type Story = StoryObj<typeof ViewSwitcher>;

export const Default: Story = {
  args: { active: "routes" },
  decorators: [
    (S) => (
      <div className="bg-bg-panel p-4 w-fit">
        <S />
      </div>
    ),
  ],
};

export const Interactive: Story = {
  render: () => {
    const [active, setActive] = useState<SolverView>("routes");
    return (
      <div className="bg-bg-panel p-4 w-fit">
        <ViewSwitcher active={active} onSelect={setActive} />
      </div>
    );
  },
};
