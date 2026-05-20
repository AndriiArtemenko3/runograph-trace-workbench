import clsx from "clsx";

/**
 * Right-pane metrics card. Renders the 5 first-cut route metrics
 * (efficiency / drift / loopiness / recovery / tool-discipline) plus
 * a small "footnotes" row with event_count, unique_targets, error_count.
 *
 * Polarity colouring is hand-set per metric: higher efficiency / recovery
 * / tool-discipline is good; higher drift / loopiness / error_count is
 * worse. Mid-range stays neutral.
 */

const METRIC_ORDER: { key: string; label: string; polarity: "up" | "down" | "neutral" }[] = [
  { key: "efficiency", label: "Efficiency", polarity: "up" },
  { key: "drift", label: "Drift", polarity: "down" },
  { key: "loopiness", label: "Loopiness", polarity: "down" },
  { key: "recovery", label: "Recovery", polarity: "up" },
  { key: "tool_discipline", label: "Tool discipline", polarity: "up" },
];

const FOOTNOTE_ORDER: { key: string; label: string }[] = [
  { key: "event_count", label: "Events" },
  { key: "unique_targets", label: "Unique targets" },
  { key: "error_count", label: "Errors" },
];

function format(value: number, decimals = 3): string {
  if (Number.isInteger(value)) return value.toString();
  if (Math.abs(value) < 0.0001) return "0";
  return value.toFixed(decimals);
}

function toneFor(
  value: number,
  polarity: "up" | "down" | "neutral",
): string {
  if (polarity === "neutral") return "text-text-primary";
  if (value === 0 || Number.isNaN(value)) return "text-text-tertiary";
  if (polarity === "up") {
    if (value > 0.5) return "text-status-success";
    if (value > 0.2) return "text-text-primary";
    return "text-status-danger";
  }
  // polarity === "down"
  if (value > 0.5) return "text-status-danger";
  if (value > 0.2) return "text-text-primary";
  return "text-status-success";
}

export interface RouteMetricsProps {
  title: string;
  subtitle?: string;
  metrics: Record<string, number>;
  /** Experiment-wide reference values (e.g. size-weighted mean across
   *  clusters). When provided, each metric row gets a 3-px bar showing the
   *  current value on a 0..1 axis with a baseline marker. */
  baseline?: Record<string, number>;
  className?: string;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function RouteMetrics({
  title,
  subtitle,
  metrics,
  baseline,
  className,
}: RouteMetricsProps) {
  return (
    <section
      aria-label="Route metrics"
      className={clsx(
        "rounded-md bg-bg-panel border border-border-hairline p-3 flex flex-col gap-2",
        className,
      )}
    >
      <header className="pb-1">
        <h3 className="text-text-primary font-sans text-sm font-medium">{title}</h3>
        {subtitle ? (
          <div className="text-text-tertiary text-2xs font-mono">{subtitle}</div>
        ) : null}
      </header>
      <dl className="grid grid-cols-2 gap-2 m-0">
        {METRIC_ORDER.map((m) => {
          const v = metrics[m.key] ?? 0;
          const base = baseline?.[m.key];
          const showBar = base != null && Number.isFinite(base);
          const valuePct = clamp01(v) * 100;
          const basePct = showBar ? clamp01(base) * 100 : 0;
          return (
            <div key={m.key} className="flex flex-col">
              <dt className="text-text-tertiary text-2xs uppercase tracking-wide">
                {m.label}
              </dt>
              <dd
                className={clsx(
                  "font-mono text-base tabular-nums",
                  toneFor(v, m.polarity),
                )}
              >
                {format(v)}
              </dd>
              {showBar ? (
                <div
                  className="relative mt-1 h-[3px] w-full bg-border-subtle rounded-full"
                  role="img"
                  aria-label={`${m.label} ${format(v)}, baseline ${format(base)}`}
                  title={`baseline ${format(base)}`}
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-accent-primary rounded-full"
                    style={{ width: `${valuePct}%` }}
                  />
                  <div
                    className="absolute -top-[2px] h-[7px] w-[2px] bg-text-secondary"
                    style={{ left: `calc(${basePct}% - 1px)` }}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </dl>
      <hr className="border-border-subtle border-t" />
      <dl className="grid grid-cols-3 gap-2 m-0">
        {FOOTNOTE_ORDER.map((m) => {
          const v = metrics[m.key] ?? 0;
          return (
            <div key={m.key} className="flex flex-col">
              <dt className="text-text-tertiary text-2xs uppercase tracking-wide">
                {m.label}
              </dt>
              <dd className="text-text-primary font-mono text-xs tabular-nums">
                {format(v, 0)}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
