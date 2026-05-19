import type { Config } from "tailwindcss";

/**
 * Tailwind theme bound to the CSS variables in src/styles/tokens.css.
 *
 * Every token name in the Figma collection ("RunoGraph Tokens") has a Tailwind
 * alias here. Components consume tokens via these aliases (bg-bg-canvas,
 * text-text-primary, heat-productivity-500, etc.) — never via hex literals.
 *
 * The shape mirrors the Figma variable groups (bg/text/border/accent/heat/
 * status/font/size/lineHeight/space/radius) so the design system maps 1:1.
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}", "./.storybook/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    // override defaults — we want the design-system tokens to be the ONLY
    // values used in classnames.
    fontFamily: {
      sans: "var(--rg-font-sans)",
      mono: "var(--rg-font-mono)",
    },
    fontSize: {
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
        canvas: "var(--rg-bg-canvas)",
        panel: "var(--rg-bg-panel)",
        elevated: "var(--rg-bg-elevated)",
        sunken: "var(--rg-bg-sunken)",
      },
      text: {
        primary: "var(--rg-text-primary)",
        secondary: "var(--rg-text-secondary)",
        tertiary: "var(--rg-text-tertiary)",
        disabled: "var(--rg-text-disabled)",
        accent: "var(--rg-text-accent)",
      },
      border: {
        hairline: "var(--rg-border-hairline)",
        subtle: "var(--rg-border-subtle)",
        strong: "var(--rg-border-strong)",
      },
      accent: {
        primary: "var(--rg-accent-primary)",
        hover: "var(--rg-accent-hover)",
        pressed: "var(--rg-accent-pressed)",
      },
      heat: {
        productivity: {
          100: "var(--rg-heat-productivity-100)",
          200: "var(--rg-heat-productivity-200)",
          300: "var(--rg-heat-productivity-300)",
          400: "var(--rg-heat-productivity-400)",
          500: "var(--rg-heat-productivity-500)",
        },
        pollution: {
          100: "var(--rg-heat-pollution-100)",
          200: "var(--rg-heat-pollution-200)",
          300: "var(--rg-heat-pollution-300)",
          400: "var(--rg-heat-pollution-400)",
          500: "var(--rg-heat-pollution-500)",
        },
      },
      status: {
        success: "var(--rg-status-success)",
        warning: "var(--rg-status-warning)",
        danger: "var(--rg-status-danger)",
        info: "var(--rg-status-info)",
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
