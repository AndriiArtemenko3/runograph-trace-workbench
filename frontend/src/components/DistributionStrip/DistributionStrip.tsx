import { useMemo, useRef, useState } from "react";
import clsx from "clsx";

/**
 * Single-row histogram strip with optional brushing.
 *
 * Renders one bar per bin over the supplied real-scalar values. The label
 * sits left; median / p95 / σ statistics render to the right of the bars.
 * Click-drag across bins emits an `onBrush(range)` callback with the
 * inclusive [min, max] of the brushed bin range so callers can re-scope
 * downstream views (e.g. the aggregate graph) to runs inside the range.
 *
 * Real-scalar input only — the strip never derives composite metrics.
 * The caller passes a raw array (cost USD, latency seconds, tokens,
 * event count) and the median/p95/σ scalars from the same distribution.
 */

export interface DistributionStripProps {
  label: string;
  values: number[];
  /** Pre-computed distribution statistics (already on screen elsewhere). */
  median: number;
  p95: number;
  sigma: number;
  /** Formatter used for label / hover / brush range readout. */
  format: (n: number) => string;
  /** Active brushed range, controlled by the parent. `null` = none. */
  brushRange?: [number, number] | null;
  /** Emit when the user releases a brush gesture. Null = clear. */
  onBrush?: (range: [number, number] | null) => void;
  /** Bin count. Default 32, capped so very small distributions stay legible. */
  bins?: number;
  className?: string;
}

interface BinSummary {
  start: number;
  end: number;
  count: number;
  inBrush: boolean;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const lov = sorted[lo] ?? 0;
  const hiv = sorted[hi] ?? lov;
  if (lo === hi) return lov;
  return lov + (hiv - lov) * (idx - lo);
}

function buildBins(
  values: number[],
  binCount: number,
  brush: [number, number] | null,
): { bins: BinSummary[]; min: number; max: number } {
  if (values.length === 0) {
    return { bins: [], min: 0, max: 0 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const bins: BinSummary[] = Array.from({ length: binCount }, (_, i) => {
    const start = min + (span * i) / binCount;
    const end = min + (span * (i + 1)) / binCount;
    const inBrush = brush ? !(end < brush[0] || start > brush[1]) : false;
    return { start, end, count: 0, inBrush };
  });
  for (const v of values) {
    let idx = Math.floor(((v - min) / span) * binCount);
    if (idx === binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    const bin = bins[idx];
    if (bin) bin.count += 1;
  }
  return { bins, min, max };
}

export function DistributionStrip({
  label,
  values,
  median,
  p95,
  sigma,
  format,
  brushRange = null,
  onBrush,
  bins: binCount = 32,
  className,
}: DistributionStripProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);

  const { bins } = useMemo(
    () => buildBins(values, binCount, brushRange),
    [values, binCount, brushRange],
  );
  const maxCount = useMemo(
    () => bins.reduce((m, b) => (b.count > m ? b.count : m), 0) || 1,
    [bins],
  );

  // Quantile fallback when the parent did not supply pre-computed scalars.
  const fallbackStats = useMemo(() => {
    if (values.length === 0) return { median: 0, p95: 0, sigma: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const m = quantile(sorted, 0.5);
    const p = quantile(sorted, 0.95);
    const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const variance =
      sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / sorted.length;
    return { median: m, p95: p, sigma: Math.sqrt(variance) };
  }, [values]);

  const displayedMedian = Number.isFinite(median) ? median : fallbackStats.median;
  const displayedP95 = Number.isFinite(p95) ? p95 : fallbackStats.p95;
  const displayedSigma = Number.isFinite(sigma) ? sigma : fallbackStats.sigma;

  const pxToBin = (clientX: number): number | null => {
    const el = ref.current;
    if (!el || bins.length === 0) return null;
    const rect = el.getBoundingClientRect();
    const local = clientX - rect.left;
    let idx = Math.floor((local / rect.width) * bins.length);
    if (idx < 0) idx = 0;
    if (idx >= bins.length) idx = bins.length - 1;
    return idx;
  };

  // Refs mirror the brush endpoints so handleMouseUp can read the final
  // values synchronously. State setters drive the visual preview during
  // drag; refs are the source of truth on commit. Without this the rapid
  // mousedown → mouseup (single-bin click or fast drag) lands before
  // React flushes the dragEnd state and the brush silently no-ops.
  const dragStartRef = useRef<number | null>(null);
  const dragEndRef = useRef<number | null>(null);

  const handleMouseDown = (ev: React.MouseEvent) => {
    if (!onBrush) return;
    const idx = pxToBin(ev.clientX);
    if (idx == null) return;
    dragStartRef.current = idx;
    dragEndRef.current = idx;
    setDragStart(idx);
    setDragEnd(idx);
  };

  const handleMouseMove = (ev: React.MouseEvent) => {
    if (dragStartRef.current == null) return;
    const idx = pxToBin(ev.clientX);
    if (idx != null) {
      dragEndRef.current = idx;
      setDragEnd(idx);
    }
  };

  const handleMouseUp = () => {
    const start = dragStartRef.current;
    const end = dragEndRef.current;
    dragStartRef.current = null;
    dragEndRef.current = null;
    setDragStart(null);
    setDragEnd(null);
    if (start == null || end == null || !onBrush) return;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const loBin = bins[lo];
    const hiBin = bins[hi];
    if (loBin && hiBin) {
      onBrush([loBin.start, hiBin.end]);
    }
  };

  const handleClear = () => {
    if (onBrush) onBrush(null);
  };

  const activeRangeReadout =
    brushRange != null
      ? `${format(brushRange[0])}..${format(brushRange[1])}`
      : null;

  // Live preview range during drag
  const previewRange = (() => {
    if (dragStart == null || dragEnd == null) return null;
    const lo = bins[Math.min(dragStart, dragEnd)];
    const hi = bins[Math.max(dragStart, dragEnd)];
    return lo && hi ? ([lo.start, hi.end] as [number, number]) : null;
  })();

  return (
    <div
      className={clsx(
        "flex items-center gap-3 text-xs font-mono text-text-secondary",
        className,
      )}
    >
      <div className="w-16 shrink-0 uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
      <div
        ref={ref}
        role="img"
        aria-label={`${label} distribution: median ${format(displayedMedian)}, p95 ${format(displayedP95)}`}
        className="relative h-7 flex-1 select-none cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          if (dragStart != null) handleMouseUp();
        }}
      >
        <div className="absolute inset-0 flex items-end gap-px">
          {bins.map((b, i) => {
            const h = (b.count / maxCount) * 100;
            const inLivePreview = previewRange
              ? !(b.end < previewRange[0] || b.start > previewRange[1])
              : false;
            const active = inLivePreview || b.inBrush;
            return (
              <div
                key={i}
                style={{ height: `${Math.max(h, b.count > 0 ? 6 : 1)}%` }}
                className={clsx(
                  "flex-1 transition-colors",
                  active
                    ? "bg-accent-primary"
                    : b.count > 0
                      ? "bg-border-strong"
                      : "bg-border-subtle",
                )}
                title={`${format(b.start)}..${format(b.end)} · ${b.count}`}
              />
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
        <span>
          <span className="text-text-primary">{format(displayedMedian)}</span>{" "}
          median
        </span>
        <span>
          p95 <span className="text-text-primary">{format(displayedP95)}</span>
        </span>
        <span>
          σ <span className="text-text-primary">{format(displayedSigma)}</span>
        </span>
        {activeRangeReadout ? (
          <button
            type="button"
            onClick={handleClear}
            className="rounded-sm border border-border-hairline px-1.5 py-0.5 text-text-primary hover:text-status-danger"
            aria-label={`Clear ${label} filter`}
          >
            {activeRangeReadout} ×
          </button>
        ) : null}
      </div>
    </div>
  );
}
