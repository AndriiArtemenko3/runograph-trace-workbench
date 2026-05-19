import clsx from "clsx";

/**
 * Recommendation pill — the right-pane card that surfaces a single
 * solver verdict (top-pick or runner-up). Bit-locked to Figma master
 * 17:30 (page 02 Components v2).
 *
 * Variants by `kind`:
 *   top-pick   gold (status-warning) 2 px border, ◆ marker         (id 17:2)
 *   runner-up  border-subtle 1 px,   ▲ marker, RUNNER-UP eyebrow   (id 17:17)
 *
 * Layout (same for both kinds):
 *   ┌──────────────────────────────────────────────────┐
 *   │ (eyebrow — runner-up only)                       │  ← 10 px Inter Medium tracking-[1px]
 *   │ ◆/▲  Harness B   +0.52                           │  ← 14 px Inter Semi-Bold
 *   │ claude-haiku triage → sonnet edit / 3-retry      │  ← 11 px JetBrains Mono Medium
 *   │ • 47 of 50 bug-fix tasks passed (94%)            │  ← 12 px Inter Regular + 6 px dot
 *   │ • −42% token spend vs frontier-only              │
 *   │ ● discovery: triage-then-escalate beats single-…  │  ← accent dot signals discovery
 *   └──────────────────────────────────────────────────┘
 *   360 wide, p-4 (16 px), gap-3 (12 px), rounded-xl
 *
 * The canon 🏆 emoji is replaced with ◆ — the design-system style guide
 * disallows emojis in code/UI output (per the global Tier-1 AI-tell list).
 */

export type RecommendationKind = "top-pick" | "runner-up";
export type BulletTone = "neutral" | "accent";

export interface RecommendationBullet {
  text: string;
  tone?: BulletTone;
}

export interface RecommendationPillProps {
  kind: RecommendationKind;
  harnessId: string;
  ev: string;
  descriptor: string;
  bullets: RecommendationBullet[];
  className?: string;
}

export function RecommendationPill({
  kind,
  harnessId,
  ev,
  descriptor,
  bullets,
  className,
}: RecommendationPillProps) {
  const isTopPick = kind === "top-pick";
  return (
    <article
      className={clsx(
        // Canon: 360 wide, rounded-xl, p-4, gap-3.
        "w-[360px] rounded-xl bg-bg-panel p-4 flex flex-col gap-3",
        isTopPick
          ? "border-2 border-status-warning"
          : "border border-border-subtle",
        className,
      )}
      data-canon={isTopPick ? "recpill-17:2" : "recpill-17:17"}
      data-kind={kind}
    >
      {!isTopPick ? (
        <div className="font-sans text-2xs font-medium uppercase tracking-widest text-text-tertiary">
          Runner-up
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={clsx(
            "font-sans text-lg font-medium leading-none",
            isTopPick ? "text-status-warning" : "text-text-tertiary",
          )}
        >
          {isTopPick ? "◆" : "▲"}
        </span>
        <span className="font-sans text-md font-semibold text-text-primary tabular-nums">
          {harnessId}
          <span className="ml-2">{ev}</span>
        </span>
      </div>
      <p className="font-mono text-xs font-medium text-text-secondary leading-snug">
        {descriptor}
      </p>
      <ul className="flex flex-col gap-1 m-0 p-0 list-none">
        {bullets.map((b, i) => (
          <li
            key={i}
            className="flex items-start gap-2 py-0.5 text-text-secondary font-sans text-sm"
          >
            <span
              aria-hidden="true"
              className={clsx(
                "shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full",
                b.tone === "accent" ? "bg-accent-primary" : "bg-status-success",
              )}
            />
            <span className="leading-snug">{b.text}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
