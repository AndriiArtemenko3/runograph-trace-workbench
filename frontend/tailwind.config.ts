import type { Config } from "tailwindcss";

/**
 * Tailwind theme bound to the CSS variables in src/styles/tokens.css.
 *
 * Every token name in the Figma collection ("RunoGraph Tokens") has a Tailwind
 * alias here. Components consume tokens via these aliases (bg-bg-canvas,
 * text-text-primary, heat-productivity-500, etc.) — never via hex literals.
 *
 * Colors are bound as `rgb(var(--rg-X) / <alpha-value>)` so Tailwind's opacity
 * modifiers (`bg-bg-elevated/40`, `text-text-primary/80`, etc.) synthesise
 * real alpha against the channel-form variables declared in tokens.css.
 * Solid utilities keep working because `<alpha-value>` defaults to `1`.
 *
 * The shape mirrors the Figma variable groups (bg/text/border/accent/heat/
 * status/font/size/lineHeight/space/radius) so the design system maps 1:1.
 */
const rgb = (token: string) => `rgb(var(${token}) / <alpha-value>)`;

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./.storybook/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    fontFamily: {
      sans: "var(--rg-font-sans)",
      mono: "var(--rg-font-mono)",
    },
    fontSize: {
      "2xs": ["var(--rg-size-2xs)", { lineHeight: "var(--rg-lh-tight)" }],
      xs: ["var(--rg-size-xs)", { lineHeight: "var(--rg-lh-tight)" }],
      sm: ["var(--rg-size-sm)", { lineHeight: "var(--rg-lh-snug)" }],
      base: ["var(--rg-size-base)", { lineHeight: "var(--rg-lh-normal)" }],
      md: ["var(--rg-size-md)", { lineHeight: "var(--rg-lh-normal)" }],
      lg: ["var(--rg-size-lg)", { lineHeight: "var(--rg-lh-relaxed)" }],
      xl: ["var(--rg-size-xl)", { lineHeight: "var(--rg-lh-loose)" }],
      "2xl": ["var(--rg-size-2xl)", { lineHeight: "var(--rg-lh-double)" }],
    },
    borderRadius: {
      none: "var(--rg-radius-none)",
      sm: "var(--rg-radius-sm)",
      DEFAULT: "var(--rg-radius-md)",
      md: "var(--rg-radius-md)",
      lg: "var(--rg-radius-lg)",
      xl: "var(--rg-radius-xl)",
      full: "var(--rg-radius-full)",
    },
    colors: {
      transparent: "transparent",
      current: "currentColor",
      bg: {
        canvas: rgb("--rg-bg-canvas"),
        panel: rgb("--rg-bg-panel"),
        elevated: rgb("--rg-bg-elevated"),
        sunken: rgb("--rg-bg-sunken"),
      },
      text: {
        primary: rgb("--rg-text-primary"),
        secondary: rgb("--rg-text-secondary"),
        tertiary: rgb("--rg-text-tertiary"),
        disabled: rgb("--rg-text-disabled"),
        accent: rgb("--rg-text-accent"),
      },
      border: {
        hairline: rgb("--rg-border-hairline"),
        subtle: rgb("--rg-border-subtle"),
        strong: rgb("--rg-border-strong"),
      },
      accent: {
        primary: rgb("--rg-accent-primary"),
        hover: rgb("--rg-accent-hover"),
        pressed: rgb("--rg-accent-pressed"),
      },
      heat: {
        productivity: {
          100: rgb("--rg-heat-productivity-100"),
          200: rgb("--rg-heat-productivity-200"),
          300: rgb("--rg-heat-productivity-300"),
          400: rgb("--rg-heat-productivity-400"),
          500: rgb("--rg-heat-productivity-500"),
        },
        pollution: {
          100: rgb("--rg-heat-pollution-100"),
          200: rgb("--rg-heat-pollution-200"),
          300: rgb("--rg-heat-pollution-300"),
          400: rgb("--rg-heat-pollution-400"),
          500: rgb("--rg-heat-pollution-500"),
        },
      },
      status: {
        success: rgb("--rg-status-success"),
        warning: rgb("--rg-status-warning"),
        danger: rgb("--rg-status-danger"),
        info: rgb("--rg-status-info"),
      },
    },
    extend: {
      // Design-system named spacing aliases — Tailwind's default scale (1=4px,
      // 2=8px, 3=12px, 4=16px, 8=32px, 9=36px, 12=48px, 14=56px, 16=64px,
      // 40=160px, 48=192px, …) stays available. Tokens 5/6/7 diverge from
      // Tailwind defaults (24/32/48 vs 20/24/28) so the design-system wins
      // on those keys via `extend`.
      spacing: {
        1: "var(--rg-space-1)",
        2: "var(--rg-space-2)",
        3: "var(--rg-space-3)",
        4: "var(--rg-space-4)",
        5: "var(--rg-space-5)",
        6: "var(--rg-space-6)",
        7: "var(--rg-space-7)",
      },
    },
  },
  plugins: [],
};

export default config;
