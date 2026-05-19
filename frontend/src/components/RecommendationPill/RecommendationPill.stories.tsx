import type { Meta, StoryObj } from "@storybook/react";
import { RecommendationPill } from "./RecommendationPill";

const meta: Meta<typeof RecommendationPill> = {
  title: "Atoms / Recommendation pill",
  component: RecommendationPill,
  parameters: {
    docs: {
      description: {
        component: `Right-pane verdict card — the winning harness (top-pick) or its closest neighbour (runner-up).

Variants: \`kind\` (top-pick / runner-up) = 2. Bit-locked to Figma master **Recommendation pill** (id 17:30, page 02 Components v2).

360 × auto, p-4, gap-3, rounded-xl. Top-pick gets a 2-px gold (status-warning) border + ◆ marker; runner-up gets a 1-px border-subtle + ▲ marker + RUNNER-UP eyebrow. Bullet dots default to status-success; an \`accent\` bullet swaps in accent-primary to flag a discovery row.

Canon 🏆 emoji is replaced with ◆ — emoji-free per the global AI-tell list.`,
      },
    },
  },
  argTypes: {
    kind: { control: "select", options: ["top-pick", "runner-up"] },
  },
};
export default meta;

type Story = StoryObj<typeof RecommendationPill>;

export const TopPick: Story = {
  args: {
    kind: "top-pick",
    harnessId: "Harness B",
    ev: "+0.52",
    descriptor: "claude-haiku triage → sonnet edit → claude-judge / 3-retry",
    bullets: [
      { text: "47 of 50 bug-fix tasks passed (94%)" },
      { text: "−42% token spend vs frontier-only" },
      { text: "discovery: triage-then-escalate beats single-model on multi-file edits", tone: "accent" },
    ],
  },
};

export const RunnerUp: Story = {
  args: {
    kind: "runner-up",
    harnessId: "Harness A",
    ev: "+0.20",
    descriptor: "claude-sonnet / dense retrieval / no triage",
    bullets: [
      { text: "36 of 50 bug-fix tasks passed (72%)" },
      { text: "lowest p95 latency in the set (3.4 s)" },
    ],
  },
};

export const All2Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-3 p-4 bg-bg-canvas">
      <RecommendationPill
        kind="top-pick"
        harnessId="Harness B"
        ev="+0.52"
        descriptor="claude-haiku triage → sonnet edit → claude-judge / 3-retry"
        bullets={[
          { text: "47 of 50 bug-fix tasks passed (94%)" },
          { text: "−42% token spend vs frontier-only" },
          { text: "discovery: triage-then-escalate beats single-model on multi-file edits", tone: "accent" },
        ]}
      />
      <RecommendationPill
        kind="runner-up"
        harnessId="Harness A"
        ev="+0.20"
        descriptor="claude-sonnet / dense retrieval / no triage"
        bullets={[
          { text: "36 of 50 bug-fix tasks passed (72%)" },
          { text: "lowest p95 latency in the set (3.4 s)" },
        ]}
      />
    </div>
  ),
};
