import clsx from "clsx";

/**
 * Status-bar entry — dot + label, used in the bottom chrome bar.
 *
 * Canonical pattern extracted from the Figma Chrome / Bottom bar master
 * (instance 125:96 in page \"03 Solver Grid v2\"). Each entry is an 8 px
 * circular status dot followed by Inter Regular 11 px text/secondary.
 *
 * Variants by `tone` (= dot fill):
 *   info     → status/info     (#4C9AFF)  — sim infra (vLLM, queue, db)
 *   success  → status/success  (#36B37E)  — green telemetry (run done, p50 ok)
 *   warning  → status/warning  (#FFB454)  — yellow alerts (rate-limited, slow)
 *   danger   → status/danger   (#FF6B6B)  — red alerts (failed run, panic)
 *
 * The dot uses a real CSS background, not the canon SVG/PNG ellipse, so
 * the entry stays pure-React (no image asset round-trip). The label is
 * truncate-flex so long telemetry strings shrink within the bottom bar
 * before forcing a wrap.
 */

export type StatusTone = "info" | "success" | "warning" | "danger";

export interface StatusEntryProps {
  tone: StatusTone;
  /** Short label rendered to the right of the dot, e.g. \"vLLM ready\". */
  label: string;
  /** Optional monospace detail rendered in a dimmer color after the label. */
  detail?: string;
  className?: string;
}

const DOT_BY_TONE: Record<StatusTone, string> = {
  info: "bg-status-info",
  success: "bg-status-success",
  warning: "bg-status-warning",
  danger: "bg-status-danger",
};

export function StatusEntry({ tone, label, detail, className }: StatusEntryProps) {
  return (
    <div
      className={clsx(
        "flex items-center gap-2 min-w-0",
        "font-sans text-xs text-text-secondary",
        className,
      )}
      data-tone={tone}
    >
      <span
        aria-hidden="true"
        className={clsx("shrink-0 h-2 w-2 rounded-full", DOT_BY_TONE[tone])}
      />
      <span className="text-text-primary truncate">{label}</span>
      {detail ? (
        <span className="font-mono text-text-secondary truncate">{detail}</span>
      ) : null}
    </div>
  );
}
