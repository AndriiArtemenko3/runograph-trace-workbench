import clsx from "clsx";

/**
 * Weight-profile selector — picker for the composite-EV weight preset
 * that drives every harness comparison.
 *
 * Bit-locked to Figma master 16:98 (page 02 Components v2). 6 canonical
 * variants by which preset is selected:
 *   Balanced     id 16:2     — the default (equal weight family)
 *   Startup      id 16:18    — tilt toward speed + cost
 *   Enterprise   id 16:34    — tilt toward reliability + regression-risk
 *   CI           id 16:50    — tilt toward latency + test-pass
 *   Local-agent  id 16:66    — tilt toward token spend + offline
 *   Coding-labs  id 16:82    — tilt toward route efficiency + discovery
 *
 * Canon layout: 560 wide, p-3.5, gap-2.5, rounded-lg, bg-panel,
 * border-hairline. Eyebrow label \"WEIGHT PROFILE\" (Inter Medium
 * 11 px text-tertiary tracking-wide) over a horizontal pill row, with
 * a \"Selected: <preset>\" caption underneath.
 *
 * Pill canon:
 *   selected     bg-accent-primary, text-bg-canvas (dark on accent —
 *                matches the WCAG-revised Button rule, NOT the canon
 *                text/primary white which fails contrast on blue)
 *   default      bg-panel + border-hairline + text-secondary
 *
 * Px-3 py-1.5 padding, rounded-md (4 px). Each pill is a real <button>
 * so the selector is keyboard-traversable; the parent ties them
 * together via a single `selected` value + onSelect handler.
 */

export const WEIGHT_PROFILES = [
  "Balanced",
  "Startup",
  "Enterprise",
  "CI",
  "Local-agent",
  "Coding-labs",
] as const;

export type WeightProfile = (typeof WEIGHT_PROFILES)[number];

export interface WeightProfileSelectorProps {
  selected: WeightProfile;
  onSelect?: (profile: WeightProfile) => void;
  className?: string;
}

export function WeightProfileSelector({
  selected,
  onSelect,
  className,
}: WeightProfileSelectorProps) {
  return (
    <section
      className={clsx(
        "rounded-lg bg-bg-panel border border-border-hairline",
        "p-3.5 flex flex-col gap-2.5",
        className,
      )}
      data-canon="weightprofile-16:98"
      data-selected={selected}
      aria-label="Weight profile selector"
    >
      <div className="text-text-tertiary text-xs font-medium uppercase tracking-wide">
        Weight profile
      </div>
      <div role="radiogroup" className="flex flex-wrap gap-2">
        {WEIGHT_PROFILES.map((profile) => {
          const isSelected = profile === selected;
          return (
            <button
              key={profile}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onSelect?.(profile)}
              className={clsx(
                "h-8 px-3 rounded-md font-sans text-sm font-medium",
                "transition-colors",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary",
                isSelected
                  ? "bg-accent-primary text-bg-canvas border border-transparent"
                  : "bg-bg-panel border border-border-hairline text-text-secondary hover:text-text-primary hover:bg-bg-elevated",
              )}
              data-profile={profile}
            >
              {profile}
            </button>
          );
        })}
      </div>
      <div className="text-text-tertiary text-xs font-sans">
        Selected: <span className="text-text-primary">{selected}</span>
      </div>
    </section>
  );
}
