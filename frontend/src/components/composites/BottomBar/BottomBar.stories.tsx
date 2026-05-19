import type { Meta, StoryObj } from "@storybook/react";
import { BottomBar } from "./BottomBar";

const meta: Meta<typeof BottomBar> = {
  title: "Composites / Bottom-bar",
  component: BottomBar,
  parameters: {
    docs: {
      description: {
        component: `Chrome bottom-bar — 36 px tall, bg-elevated. Two clusters: infra (left) and telemetry (right). Reuses StatusEntry atoms.`,
      },
    },
    layout: "fullscreen",
  },
};
export default meta;

type Story = StoryObj<typeof BottomBar>;

export const Default: Story = {
  args: {
    left: [
      { tone: "info", label: "200 sims complete", detail: "50×4 · 14m 22s" },
      { tone: "info", label: "Ollama llama-70b", detail: "GPU 78% · 24GB / 80GB" },
      { tone: "success", label: "Top: Harness B", detail: "+0.52 · 94% pass" },
    ],
    right: [
      { tone: "success", label: "workers 8/8", detail: "p50 1.4s · p95 5.2s" },
      { tone: "success", label: "v0.3-alpha", detail: "14:22" },
    ],
  },
  decorators: [
    (S) => (
      <div className="bg-bg-canvas w-[1440px]">
        <S />
      </div>
    ),
  ],
};
