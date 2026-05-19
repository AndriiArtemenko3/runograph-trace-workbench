import { Fragment } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { NodeEVCell } from "./NodeEVCell";
import type { EVMagnitude } from "../EVCell";

const MAGNITUDES: EVMagnitude[] = [1, 2, 3, 4, 5];

const meta: Meta<typeof NodeEVCell> = {
  title: "Atoms / Node-EV-cell",
  component: NodeEVCell,
  parameters: {
    docs: {
      description: {
        component: `Compact numeric-only EV cell — 64×32 — for dense tables.

Variants: \`sign\` (positive / negative) × \`magnitude\` (1..5) = 10. Bit-locked to Figma master **Node-EV-cell** (id 14:22, page 02 Components v2).

Difference vs. the larger \`EV-cell\`: no label row, smaller box, used wherever multiple stages or signals need to be shown side-by-side without taking matrix-cell footprint.`,
      },
    },
  },
  argTypes: {
    sign: { control: "select", options: ["positive", "negative"] },
    magnitude: { control: { type: "number", min: 1, max: 5 } },
  },
};
export default meta;

type Story = StoryObj<typeof NodeEVCell>;

export const Default: Story = {
  args: { value: "+0.31", sign: "positive", magnitude: 4 },
};

/** Canonical 2×5 grid — sign × magnitude = 10 variants. */
export const All10Variants: Story = {
  render: () => (
    <div className="bg-bg-panel border border-border-hairline rounded-md p-4">
      <div className="grid grid-cols-[auto_repeat(5,64px)] gap-3 items-center">
        <span />
        {MAGNITUDES.map((m) => (
          <span
            key={m}
            className="text-text-secondary text-xs font-mono text-center"
          >
            mag {m}
          </span>
        ))}
        <span className="text-text-secondary text-xs font-mono pr-2">+ positive</span>
        {MAGNITUDES.map((m) => (
          <NodeEVCell
            key={`p-${m}`}
            value={m === 1 ? "+0.04" : m === 2 ? "+0.09" : m === 3 ? "+0.16" : m === 4 ? "+0.24" : "+0.31"}
            sign="positive"
            magnitude={m}
          />
        ))}
        <span className="text-text-secondary text-xs font-mono pr-2">− negative</span>
        {MAGNITUDES.map((m) => (
          <NodeEVCell
            key={`n-${m}`}
            value={m === 1 ? "−0.02" : m === 2 ? "−0.05" : m === 3 ? "−0.11" : m === 4 ? "−0.18" : "−0.24"}
            sign="negative"
            magnitude={m}
          />
        ))}
      </div>
    </div>
  ),
};

export const StageDecompositionStrip: Story = {
  render: () => (
    <div className="bg-bg-panel border border-border-hairline rounded-md p-3 w-[360px]">
      <div className="grid grid-cols-[auto_repeat(4,64px)] gap-2 items-center">
        <span className="text-text-secondary text-xs font-mono uppercase tracking-wide">
          STAGE
        </span>
        {["A", "B", "C", "D"].map((h) => (
          <span
            key={h}
            className="text-text-secondary text-xs font-mono text-center uppercase"
          >
            {h}
          </span>
        ))}
        {(
          [
            { stage: "plan", cells: [
              { value: "+0.04", sign: "positive", magnitude: 1 },
              { value: "+0.04", sign: "positive", magnitude: 1 },
              { value: "−0.02", sign: "negative", magnitude: 1 },
              { value: "−0.05", sign: "negative", magnitude: 2 },
            ] },
            { stage: "retrieve", cells: [
              { value: "+0.08", sign: "positive", magnitude: 1 },
              { value: "+0.07", sign: "positive", magnitude: 1 },
              { value: "+0.01", sign: "positive", magnitude: 1 },
              { value: "−0.09", sign: "negative", magnitude: 2 },
            ] },
            { stage: "edit", cells: [
              { value: "+0.05", sign: "positive", magnitude: 1 },
              { value: "+0.31", sign: "positive", magnitude: 5 },
              { value: "−0.01", sign: "negative", magnitude: 1 },
              { value: "−0.07", sign: "negative", magnitude: 2 },
            ] },
            { stage: "test", cells: [
              { value: "+0.02", sign: "positive", magnitude: 1 },
              { value: "+0.06", sign: "positive", magnitude: 1 },
              { value: "+0.01", sign: "positive", magnitude: 1 },
              { value: "−0.06", sign: "negative", magnitude: 2 },
            ] },
            { stage: "repair", cells: [
              { value: "+0.01", sign: "positive", magnitude: 1 },
              { value: "+0.04", sign: "positive", magnitude: 1 },
              { value: "+0.00", sign: "positive", magnitude: 1 },
              { value: "−0.03", sign: "negative", magnitude: 1 },
            ] },
          ] as const
        ).map((s) => (
          <Fragment key={s.stage}>
            <span className="text-text-primary text-sm font-sans pr-2">
              {s.stage}
            </span>
            {s.cells.map((c, i) => (
              <NodeEVCell
                key={`${s.stage}-${i}`}
                value={c.value}
                sign={c.sign}
                magnitude={c.magnitude}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Real use: the Stage-decomposition table that lives in the right pane of the Solver Grid. 5 stages × 4 harnesses = 20 NodeEVCells, with the canon Harness-B-edit cell at mag 5 driving most of the +0.32 EV gap between A and B.",
      },
    },
  },
};
