import clsx from "clsx";
import type { ReactNode } from "react";

/**
 * Panel — generic bordered container with optional header / footer slots.
 *
 * Bit-locked to Figma master 15:45 (page 02 Components v2). The 3
 * canonical variants are derived from which slots are populated:
 *   with-header  header present, no footer            (id 15:27)
 *   no-header    no header, no footer                  (id 15:33)
 *   with-footer  header AND footer                     (id 15:36)
 *
 * Canon dimensions: 280×180, rounded-lg (6 px), bg-panel,
 * border-hairline 1 px. Header / body / footer rows use px-3.5
 * (14 px) and py-2.5 (10 px) / py-3.5 (14 px) for body.
 *
 * Typography:
 *   header   Inter Semi-Bold 12 px text-primary
 *   body     Inter Regular 12 px text-secondary
 *   footer   Inter Regular 11 px text-tertiary
 *
 * Divider rule (per canon section P2 note):
 *   with-header only  → border-subtle divider
 *   with-footer       → border-hairline dividers above + below body
 */

export interface PanelProps {
  /** Optional header content (typically a string title; ReactNode for complex). */
  header?: ReactNode;
  /** Optional footer content (caption, sub-stats, action row). */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ header, footer, children, className }: PanelProps) {
  const hasHeader = header !== undefined && header !== null;
  const hasFooter = footer !== undefined && footer !== null;
  const variant: "with-header" | "with-footer" | "no-header" = hasFooter
    ? "with-footer"
    : hasHeader
      ? "with-header"
      : "no-header";
  // Canon: with-header alone softens the divider to border-subtle;
  // when a footer is also present, the canon switches back to hairline
  // for both dividers (matches the with-footer Figma sample).
  const dividerClass = variant === "with-header" ? "bg-border-subtle" : "bg-border-hairline";

  return (
    <section
      className={clsx(
        "rounded-lg bg-bg-panel border border-border-hairline",
        "flex flex-col overflow-hidden",
        className,
      )}
      data-canon={
        variant === "with-header"
          ? "panel-15:27"
          : variant === "with-footer"
            ? "panel-15:36"
            : "panel-15:33"
      }
      data-variant={variant}
    >
      {hasHeader ? (
        <>
          <header className="px-3.5 py-2.5 flex items-center">
            {typeof header === "string" ? (
              <h3 className="font-sans text-sm font-semibold text-text-primary">
                {header}
              </h3>
            ) : (
              header
            )}
          </header>
          <div className={clsx("h-px w-full shrink-0", dividerClass)} aria-hidden="true" />
        </>
      ) : null}
      <div className="flex-1 min-h-0 px-3.5 py-3.5 text-text-secondary text-sm font-sans">
        {children}
      </div>
      {hasFooter ? (
        <>
          <div className="h-px w-full shrink-0 bg-border-hairline" aria-hidden="true" />
          <footer className="px-3.5 py-2.5 flex items-center text-text-tertiary text-xs font-sans">
            {footer}
          </footer>
        </>
      ) : null}
    </section>
  );
}
