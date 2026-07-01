import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TopBar } from "./TopBar";
import type { SolverView } from "../../ViewSwitcher";

const meta: Meta<typeof TopBar> = {
  title: "Composites / Top-bar",
  component: TopBar,
  parameters: {
    docs: {
      description: {
        component: `The chrome row at the top of every solver page. Reuses Button + ViewSwitcher atoms; renders a Weight-profile chip and Run Sim primary action.`,
      },
    },
    layout: "fullscreen",
  },
};
export default meta;

type Story = StoryObj<typeof TopBar>;

export const Default: Story = {
  args: {
    brand: "RunoGraph",
    crumb: "/ 03 Solver Grid",
    weightProfile: "Balanced",
    activeView: "routes",
  },
  decorators: [
    (S) => (
      <div className="bg-bg-canvas w-[1440px]">
        <S />
      </div>
    ),
  ],
};

export const Interactive: Story = {
  render: () => {
    const [view, setView] = useState<SolverView>("routes");
    const [weight, setWeight] = useState("Balanced");
    return (
      <div className="bg-bg-canvas w-[1440px]">
        <TopBar
          brand="RunoGraph"
          crumb="/ 03 Solver Grid"
          weightProfile={weight}
          activeView={view}
          onViewChange={setView}
          onWeightProfileClick={() => setWeight(weight === "Balanced" ? "Startup" : "Balanced")}
          onRunSim={() => alert("Run Sim clicked")}
        />
      </div>
    );
  },
};
