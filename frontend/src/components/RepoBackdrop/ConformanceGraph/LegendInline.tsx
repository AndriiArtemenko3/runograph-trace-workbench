import { THEME } from "./_layout";

interface LegendInlineProps {
  color: string;
  dashed: boolean;
  label: string;
  description?: string;
}

export function LegendInline({ color, dashed, label, description }: LegendInlineProps) {
  return (
    <span className="inline-flex items-center gap-1.5" title={description}>
      <svg width={20} height={4} aria-hidden="true">
        <line
          x1={0}
          y1={2}
          x2={20}
          y2={2}
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={dashed ? "4 2.5" : undefined}
        />
      </svg>
      <span style={{ color: THEME.bodyText }}>{label}</span>
      {description ? <span className="sr-only"> — {description}</span> : null}
    </span>
  );
}
