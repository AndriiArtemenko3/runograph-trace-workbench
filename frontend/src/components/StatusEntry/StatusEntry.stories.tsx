import type { Meta, StoryObj } from "@storybook/react";
import { StatusEntry, type StatusTone } from "./StatusEntry";

const TONES: StatusTone[] = ["info", "success", "warning", "danger"];

const meta: Meta<typeof StatusEntry> = {
  title: "Atoms / Status-bar entry",
  component: StatusEntry,
  parameters: {
    docs: {
      description: {
        component: `Single dot + label pair inside the chrome bottom bar.

Variants: \`tone\` (info / success / warning / danger) = 4. Extracted from the Figma Chrome / Bottom bar master (instance 125:96 inside page \"03 Solver Grid v2\").

Canon: 8 × 8 dot, Inter Regular 11 px label (text/secondary), optional JetBrains Mono detail in a dimmer tone.`,
      },
    },
  },
  argTypes: {
    tone: { control: "select", options: TONES },
  },
};
export default meta;

type Story = StoryObj<typeof StatusEntry>;

export const Default: Story = {
  args: { tone: "info", label: "vLLM", detail: "warm" },
  decorators: [
    (S) => (
      <div className="bg-bg-elevated border border-border-hairline rounded-md px-3 py-2">
        <S />
      </div>
    ),
  ],
};

/** Canonical 4-tone grid — one entry per tone, side-by-side, as they appear in the bottom bar. */
export const All4Variants: Story = {
  render: () => (
    <div className="bg-bg-elevated border border-border-hairline rounded-md p-3 flex flex-col gap-2 w-[480px]">
      {TONES.map((tone) => (
        <StatusEntry
          key={tone}
          tone={tone}
          label={tone === "info" ? "vLLM" : tone === "success" ? "p50/p95" : tone === "warning" ? "queue" : "panic"}
          detail={
            tone === "info"
              ? "warm · 0 errors"
              : tone === "success"
                ? "1.4s / 5.2s"
                : tone === "warning"
                  ? "rate-limit · 3 retries"
                  : "1 worker failed"
          }
        />
      ))}
    </div>
  ),
};

export const BottomBarRow: Story = {
  render: () => (
    <div className="bg-bg-elevated border border-border-hairline rounded-md px-6 h-9 w-[1200px] flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <StatusEntry tone="info" label="200 sims complete" detail="50×4 · 14m 22s" />
        <StatusEntry tone="info" label="Ollama llama-70b" detail="GPU 78% · 24GB / 80GB" />
        <StatusEntry tone="success" label="Top: Harness B" detail="+0.52 · 94% pass" />
      </div>
      <div className="flex items-center gap-4">
        <StatusEntry tone="success" label="workers 8/8" detail="p50 1.4s · p95 5.2s" />
        <StatusEntry tone="success" label="v0.3-alpha" detail="14:22" />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: "Real use: the canon Figma Chrome / Bottom bar reproduced 1:1 with 5 entries split into a left infra cluster and a right telemetry cluster.",
      },
    },
  },
};
