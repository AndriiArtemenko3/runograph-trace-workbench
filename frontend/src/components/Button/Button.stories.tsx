import type { Meta, StoryObj } from "@storybook/react";
import { Button, type ButtonKind, type ButtonState } from "./Button";

const KINDS: ButtonKind[] = ["primary", "secondary", "icon"];
const STATES: ButtonState[] = ["default", "hover", "pressed", "disabled"];

const meta: Meta<typeof Button> = {
  title: "Atoms / Button",
  component: Button,
  parameters: {
    docs: {
      description: {
        component: `Chrome action primitive.

Variants: \`kind\` (primary/secondary/icon) × \`state\` (default/hover/pressed/disabled) = 12.

Bit-locked to Figma master **Button** (id 15:26). 32px tall (single size for
v0.3 alpha). Primary uses the \`accent\` token chain; secondary uses
\`bg/elevated\` + \`border/subtle\`. \`icon\` kind is square 32×32 when no
children.

v2 redteam fix: primary-disabled now \`bg/panel\` + \`text/tertiary\` (≥3:1)
instead of the original \`bg/elevated\` + \`text/disabled\` (1.4:1, hard WCAG fail).

Live :hover and :active transitions are wired by default; the explicit
\`state\` prop is for Storybook screenshots / regression tests.`,
      },
    },
  },
  argTypes: {
    kind: { control: "select", options: KINDS },
    state: { control: "select", options: ["default", ...STATES.slice(1)] },
  },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: { kind: "primary", children: "Run Sim" },
};

/** Canonical 3×4 grid — 12 variants. */
export const All12Variants: Story = {
  render: () => (
    <div className="bg-bg-panel border border-border-hairline rounded-xl p-6">
      <div className="grid grid-cols-[auto_repeat(4,minmax(0,1fr))] gap-3 items-center">
        <span />
        {STATES.map((s) => (
          <span key={s} className="text-text-tertiary text-xs font-mono">
            {s}
          </span>
        ))}
        {KINDS.map((k) => (
          <>
            <span key={`label-${k}`} className="text-text-tertiary text-xs font-mono pr-3">
              {k}
            </span>
            {STATES.map((s) => (
              <Button
                key={`${k}-${s}`}
                kind={k}
                state={s}
                icon={k === "icon" ? "▶" : undefined}
              >
                {k === "icon" ? undefined : k === "primary" ? "Run Sim" : "Save"}
              </Button>
            ))}
          </>
        ))}
      </div>
    </div>
  ),
};

export const Primary: Story = {
  args: { kind: "primary", icon: "▶", children: "Run Sim" },
};

export const Secondary: Story = {
  args: { kind: "secondary", children: "Save" },
};

export const IconOnly: Story = {
  args: { kind: "icon", icon: "⌘", "aria-label": "Open command palette" },
};

export const DisabledPrimary: Story = {
  args: { kind: "primary", icon: "▶", children: "Run Sim", disabled: true },
};

/** The Solver-Grid top-bar action cluster, all in one row. */
export const TopBarCluster: Story = {
  render: () => (
    <div className="bg-bg-elevated border border-border-hairline rounded-xl p-4 inline-flex items-center gap-2">
      <Button kind="primary" icon="▶">
        Run Sim
      </Button>
      <Button kind="secondary" icon="+">
        Add Harness
      </Button>
      <Button kind="secondary" icon="↻">
        Re-Solve
      </Button>
      <Button kind="icon" icon="📂" aria-label="Open" />
      <Button kind="icon" icon="💾" aria-label="Save" />
    </div>
  ),
};
