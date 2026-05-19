import type { Meta, StoryObj } from "@storybook/react";
import { Panel } from "./Panel";

const meta: Meta<typeof Panel> = {
  title: "Atoms / Panel",
  component: Panel,
  parameters: {
    docs: {
      description: {
        component: `Generic bordered container with optional header / footer slots.

Variants derived from which slots are populated:
  with-header   header only         id 15:27
  no-header     no header, no footer  id 15:33
  with-footer   header AND footer     id 15:36

Canon 280×180, rounded-lg, bg-panel, border-hairline. Used widely in the Editor view; not load-bearing on the Solver Grid critical path.`,
      },
    },
  },
};
export default meta;

type Story = StoryObj<typeof Panel>;

export const WithHeader: Story = {
  args: {
    header: "Panel header",
    children: (
      <p className="text-text-secondary text-sm">
        Panel body content. Prose or instances.
      </p>
    ),
  },
  decorators: [
    (S) => (
      <div className="w-[280px] h-[180px] bg-bg-canvas">
        <S />
      </div>
    ),
  ],
};

export const NoHeader: Story = {
  args: {
    children: (
      <p className="text-text-secondary text-sm">
        Panel body content. Prose or instances.
      </p>
    ),
  },
  decorators: [
    (S) => (
      <div className="w-[280px] h-[180px] bg-bg-canvas">
        <S />
      </div>
    ),
  ],
};

export const WithFooter: Story = {
  args: {
    header: "Panel header",
    footer: "Footer caption",
    children: (
      <p className="text-text-secondary text-sm">
        Panel body content. Prose or instances.
      </p>
    ),
  },
  decorators: [
    (S) => (
      <div className="w-[280px] h-[180px] bg-bg-canvas">
        <S />
      </div>
    ),
  ],
};

export const All3Variants: Story = {
  render: () => (
    <div className="flex gap-4 p-4 bg-bg-canvas">
      <div className="w-[280px] h-[180px]">
        <Panel header="Panel header">
          <p className="text-text-secondary text-sm">
            Panel body content. Prose or instances.
          </p>
        </Panel>
      </div>
      <div className="w-[280px] h-[180px]">
        <Panel>
          <p className="text-text-secondary text-sm">
            Panel body content. Prose or instances.
          </p>
        </Panel>
      </div>
      <div className="w-[280px] h-[180px]">
        <Panel header="Panel header" footer="Footer caption">
          <p className="text-text-secondary text-sm">
            Panel body content. Prose or instances.
          </p>
        </Panel>
      </div>
    </div>
  ),
};
