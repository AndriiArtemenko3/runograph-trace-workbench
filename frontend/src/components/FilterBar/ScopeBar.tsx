import type { Predicate } from "../../filters/predicate";
import { predicateLabel } from "./FilterBar";

interface ScopeBarProps {
  predicates: Predicate[];
  invalid: string[];
  runIds: string[] | null;
  /** Client-computed matched-run count (null while runs are loading) —
   *  doubles as a live parity check against server-scoped row counts. */
  matchedCount: number | null;
  onRemovePredicate: (index: number) => void;
  onClearSelection: () => void;
  onClearAll: () => void;
}

/** Persistent run-scope banner, shown on every sheet while a scope is
 *  active. Removing chips refetches the server-scoped sheets. */
export function ScopeBar({
  predicates,
  invalid,
  runIds,
  matchedCount,
  onRemovePredicate,
  onClearSelection,
  onClearAll,
}: ScopeBarProps) {
  if (predicates.length === 0 && invalid.length === 0 && runIds === null) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-hairline bg-bg-sunken px-6 py-2">
      <span className="font-mono text-xs text-text-tertiary">SCOPE</span>
      {predicates.map((p, i) => (
        <button
          key={`${predicateLabel(p)}-${i}`}
          onClick={() => onRemovePredicate(i)}
          title="remove from scope"
          className="rounded-full border border-accent-primary bg-bg-elevated px-2 py-0.5 font-mono text-xs text-text-primary hover:border-status-danger"
        >
          {predicateLabel(p)} ×
        </button>
      ))}
      {invalid.map((raw) => (
        <span
          key={raw}
          className="rounded-full border border-status-danger px-2 py-0.5 font-mono text-xs text-status-danger"
        >
          invalid: {raw}
        </span>
      ))}
      {runIds !== null && (
        <button
          onClick={onClearSelection}
          title="clear selection"
          className="rounded-full border border-accent-primary bg-bg-elevated px-2 py-0.5 font-mono text-xs text-text-primary hover:border-status-danger"
        >
          {runIds.length} selected ×
        </button>
      )}
      {matchedCount !== null && (
        <span className="font-mono text-xs text-text-tertiary">
          → {matchedCount} runs
        </span>
      )}
      <button
        onClick={onClearAll}
        className="ml-auto font-mono text-xs text-text-secondary hover:text-text-primary"
      >
        clear scope
      </button>
    </div>
  );
}
