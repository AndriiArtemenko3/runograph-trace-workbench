import type { Preview } from "@storybook/react";
import "../src/styles/tokens.css";
import "../src/styles/index.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "canvas",
      values: [
        { name: "canvas", value: "#14171C" },
        { name: "panel", value: "#1A1E24" },
        { name: "elevated", value: "#1F242B" },
      ],
    },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    layout: "centered",
  },
};
export default preview;
