import clsx from "clsx";

/**
 * Real-indicator metrics panel.
 *
 * Two rendering modes driven by `mode`:
 *
 *   "group"  — cluster or experiment overview. For each scalar field,
 *              renders MEDIAN as the dominant glyph + p95 and σ inline.
 *              Surfaces pass_rate, error_rate, n_runs.
 *
 *   "run"    — single-run inspector. Renders the scalar values + a
 *              ±σ z-score badge against the optional `baseline` (typically
 *              the owning cluster's group_stats).
 *
 * The backend metric contract is documented in
 * runograph_backend/analysis/metrics.py. Keys this component reads:
 *
 *   group mode keys: n_runs, pass_rate, error_rate, <field>_median,
 *                    <field>_p95, <field>_std, <field>_mean.
 *
 *   run mode keys:   cost_usd, tokens_total, latency_s, event_count,
 *                    tool_call_count, unique_targets, error_count.
 *
 * The visual goal is replicable indicators only — no synthesised
 * abstractions. Every number on screen is auditable against the Run
 * row + event table.
 */

export interface RouteMetricsProps {
  title: string;
  subtitle?: string;
  mode: "group" | "run";
  metrics: Record<string, number>;
  /** For group mode: experiment-wide baseline (delta vs experiment).
   *  For run mode: owning-cluster group_stats (drives z-scores). */
  baseline?: Record<string, number>;
  className?: string;
}

// ----- helpers -----

const SECONDS_IN_MIN = 60;

function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd < 0.0095) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}

function formatLatency(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "—";
  if (s < SECONDS_IN_MIN) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / SECONDS_IN_MIN);
  const rem = Math.round(s - m * SECONDS_IN_MIN);
  return `${m}m${rem.toString().padStart(2, "0")}s`;
}

function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toString();
}

function formatPct(fraction: number): string {
  if (!Number.isFinite(fraction)) return "0%";
  return `${Math.round(fraction * 100)}%`;
}

function zScore(value: number, baselineMean: number, baselineStd: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(baselineMean)) return null;
  if (!Number.isFinite(baselineStd) || baselineStd < 1e-9) return null;
  return (value - baselineMean) / baselineStd;
}

function zClass(z: number, polarity: "lower-better" | "higher-better"): string {
  const sign = polarity === "lower-better" ? -1 : 1;
  const direction = z * sign;
  if (direction > 1) return "text-status-success";
  if (direction < -1) return "text-status-danger";
  return "text-text-tertiary";
}

function formatZ(z: number | null): string {
  if (z == null) return "";
  if (Math.abs(z) < 0.05) return "≈ μ";
  const sign = z > 0 ? "+" : "";
  return `${sign}${z.toFixed(2)}σ`;
}

// ----- field definitions -----

interface ScalarField {
  key: string;             // run-mode key (also stem for group-mode "_median" suffix)
  label: string;
  format: (v: number) => string;
  polarity: "lower-better" | "higher-better" | "neutral";
}

const SCALAR_FIELDS: ScalarField[] = [
  { key: "cost_usd", label: "Cost", format: formatCost, polarity: "lower-better" },
  { key: "latency_s", label: "Latency", format: formatLatency, polarity: "lower-better" },
  { key: "tokens_total", label: "Tokens", format: formatTokens, polarity: "lower-better" },
  { key: "event_count", label: "Events", format: formatInt, polarity: "neutral" },
];

const RUN_EXTRA_FIELDS: ScalarField[] = [
  { key: "unique_targets", label: "Unique targets", format: formatInt, polarity: "neutral" },
  { key: "tool_call_count", label: "Tool calls", format: formatInt, polarity: "neutral" },
  { key: "error_count", label: "Errors", format: formatInt, polarity: "lower-better" },
];

// ----- group-mode renderer -----

function GroupBlock({
  field,
  metrics,
  baseline,
}: {
  field: ScalarField;
  metrics: Record<string, number>;
  baseline?: Record<string, number>;
}) {
  const median = metrics[`${field.key}_median`] ?? 0;
  const p95 = metrics[`${field.key}_p95`] ?? 0;
  const std = metrics[`${field.key}_std`] ?? 0;

  // Delta against the experiment-wide baseline median (if baseline is the
  // experiment overview). Encoded as +/- pct so it reads natively.
  let deltaText: string | null = null;
  let deltaClass = "text-text-tertiary";
  if (baseline && field.key !== "event_count") {
    const baseMedian = baseline[`${field.key}_median`] ?? 0;
    if (Number.isFinite(baseMedian) && baseMedian > 0) {
      const pct = (median - baseMedian) / baseMedian;
      if (Math.abs(pct) >= 0.02) {
        deltaText = `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(0)}% vs exp.`;
        if (field.polarity === "lower-better") {
          deltaClass = pct < 0 ? "text-status-success" : "text-status-danger";
        } else if (field.polarity === "higher-better") {
          deltaClass = pct > 0 ? "text-status-success" : "text-status-danger";
        }
      } else {
        deltaText = "≈ exp.";
      }
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between">
        <span className="text-text-tertiary text-2xs uppercase tracking-wide">
          {field.label}
        </span>
        {deltaText ? (
          <span className={clsx("font-mono text-2xs tabular-nums", deltaClass)}>
            {deltaText}
          </span>
        ) : null}
      </div>
      <div className="font-mono text-base text-text-primary tabular-nums">
        {field.format(median)}
        <span className="text-text-tertiary text-2xs ml-1">median</span>
      </div>
      <div className="font-mono text-2xs text-text-tertiary tabular-nums">
        p95 {field.format(p95)} · σ {field.format(std)}
      </div>
    </div>
  );
}

function GroupHeader({ metrics }: { metrics: Record<string, number> }) {
  const n = metrics.n_runs ?? 0;
  const passRate = metrics.pass_rate ?? 0;
  const errorRate = metrics.error_rate ?? 0;
  return (
    <div className="grid grid-cols-3 gap-2 pt-1">
      <div className="flex flex-col">
        <span className="text-text-tertiary text-2xs uppercase">Runs</span>
        <span className="font-mono text-sm text-text-primary tabular-nums">
          {formatInt(n)}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-text-tertiary text-2xs uppercase">Pass rate</span>
        <span
          className={clsx(
            "font-mono text-sm tabular-nums",
            passRate >= 0.9
              ? "text-status-success"
              : passRate >= 0.5
                ? "text-text-primary"
                : "text-status-danger",
          )}
        >
          {formatPct(passRate)}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-text-tertiary text-2xs uppercase">Error rate</span>
        <span
          className={clsx(
            "font-mono text-sm tabular-nums",
            errorRate <= 0.05
              ? "text-status-success"
              : errorRate <= 0.2
                ? "text-text-primary"
                : "text-status-danger",
          )}
        >
          {formatPct(errorRate)}
        </span>
      </div>
    </div>
  );
}

// ----- run-mode renderer -----

function RunBlock({
  field,
  value,
  baseline,
}: {
  field: ScalarField;
  value: number;
  baseline?: Record<string, number>;
}) {
  let z: number | null = null;
  if (baseline) {
    z = zScore(
      value,
      baseline[`${field.key}_mean`] ?? NaN,
      baseline[`${field.key}_std`] ?? NaN,
    );
  }
  const zTxt = formatZ(z);
  const zCls = z != null && field.polarity !== "neutral" ? zClass(z, field.polarity as "lower-better" | "higher-better") : "text-text-tertiary";
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between">
        <span className="text-text-tertiary text-2xs uppercase tracking-wide">
          {field.label}
        </span>
        {zTxt ? (
          <span className={clsx("font-mono text-2xs tabular-nums", zCls)}>
            {zTxt}
          </span>
        ) : null}
      </div>
      <div className="font-mono text-base text-text-primary tabular-nums">
        {field.format(value)}
      </div>
    </div>
  );
}

// ----- component entry -----

export function RouteMetrics({
  title,
  subtitle,
  mode,
  metrics,
  baseline,
  className,
}: RouteMetricsProps) {
  return (
    <section
      aria-label="Route metrics"
      className={clsx(
        "rounded-md bg-bg-panel border border-border-hairline p-3 flex flex-col gap-3",
        className,
      )}
    >
      <header>
        <h3 className="text-text-primary font-sans text-sm font-medium">
          {title}
        </h3>
        {subtitle ? (
          <div className="text-text-tertiary text-2xs font-mono">{subtitle}</div>
        ) : null}
      </header>

      {mode === "group" ? (
        <>
          <GroupHeader metrics={metrics} />
          <hr className="border-border-subtle border-t" />
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            {SCALAR_FIELDS.map((f) => (
              <GroupBlock
                key={f.key}
                field={f}
                metrics={metrics}
                baseline={baseline}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            {SCALAR_FIELDS.map((f) => (
              <RunBlock
                key={f.key}
                field={f}
                value={metrics[f.key] ?? 0}
                baseline={baseline}
              />
            ))}
          </div>
          <hr className="border-border-subtle border-t" />
          <div className="grid grid-cols-3 gap-x-3 gap-y-2">
            {RUN_EXTRA_FIELDS.map((f) => (
              <div key={f.key} className="flex flex-col">
                <span className="text-text-tertiary text-2xs uppercase">
                  {f.label}
                </span>
                <span className="font-mono text-sm text-text-primary tabular-nums">
                  {f.format(metrics[f.key] ?? 0)}
                </span>
              </div>
            ))}
          </div>
          {baseline ? (
            <div className="text-text-tertiary text-2xs font-mono italic pt-1 border-t border-border-subtle">
              σ-values compare this run to its cluster's mean (n = {formatInt(baseline.n_runs ?? 0)}).
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
