import { useState } from "react";

import {
  KIND_OPS,
  ROUTE_PSEUDO_OPS,
  parsePredicate,
  serializePredicate,
  validatePredicate,
} from "../../filters/predicate";
import type {
  ColumnKind,
  Op,
  Predicate,
} from "../../filters/predicate";

export interface FilterColumn {
  key: string;
  kind: ColumnKind;
}

interface FilterBarProps {
  columns: FilterColumn[];
  predicates: Predicate[];
  invalid: string[];
  onChange: (preds: Predicate[]) => void;
}

function opsFor(column: string, kind: ColumnKind): Op[] {
  return ROUTE_PSEUDO_OPS[column] ?? KIND_OPS[kind];
}

export function predicateLabel(p: Predicate): string {
  const symbol: Record<string, string> = {
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
    eq: "=",
    in: "∈",
    contains: "~",
    between: "…",
    absgte: "|·|≥",
  };
  return `${p.column} ${symbol[p.op] ?? p.op} ${p.values.join(",")}`;
}

/** Predicate builder + active-chip row. Pure state-lifting component: all
 *  filter state lives in the URL via the parent. */
export function FilterBar({ columns, predicates, invalid, onChange }: FilterBarProps) {
  const first = columns[0];
  const [column, setColumn] = useState(first?.key ?? "");
  const [op, setOp] = useState<Op>("eq");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const kind = columns.find((c) => c.key === column)?.kind ?? "string";
  const ops = opsFor(column, kind);
  const activeOp = ops.includes(op) ? op : ops[0]!;

  const add = () => {
    try {
      const pred = parsePredicate(`${column}:${activeOp}:${value.trim()}`);
      validatePredicate(
        pred,
        Object.fromEntries(columns.map((item) => [item.key, item.kind])),
        column in ROUTE_PSEUDO_OPS,
      );
      setError(null);
      setValue("");
      onChange([...predicates, pred]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <select
        aria-label="Filter column"
        value={column}
        onChange={(e) => setColumn(e.target.value)}
        className="rounded border border-border-hairline bg-bg-sunken px-2 py-1 font-mono text-xs text-text-primary"
      >
        {columns.map((c) => (
          <option key={c.key} value={c.key}>
            {c.key}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter operator"
        value={activeOp}
        onChange={(e) => setOp(e.target.value as Op)}
        className="rounded border border-border-hairline bg-bg-sunken px-2 py-1 font-mono text-xs text-text-primary"
      >
        {ops.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <input
        aria-label="Filter value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder={activeOp === "between" ? "lo,hi" : "value"}
        className="w-40 rounded border border-border-hairline bg-bg-sunken px-2 py-1 font-mono text-xs text-text-primary placeholder:text-text-secondary"
      />
      <button
        type="button"
        onClick={add}
        className="rounded border border-border-subtle px-2 py-1 font-mono text-xs text-text-secondary hover:text-text-primary"
      >
        + filter
      </button>
      {error && (
        <span className="font-mono text-xs text-status-danger">{error}</span>
      )}
      {predicates.map((p, i) => (
        <button
          key={`${serializePredicate(p)}-${i}`}
          onClick={() => onChange(predicates.filter((_, j) => j !== i))}
          title="remove"
          className="rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 font-mono text-xs text-text-primary hover:border-status-danger"
        >
          {predicateLabel(p)} ×
        </button>
      ))}
      {invalid.map((raw) => (
        <span
          key={raw}
          className="rounded-full border border-status-danger px-2 py-0.5 font-mono text-xs text-status-danger"
          title="invalid filter — fix the URL"
        >
          invalid: {raw}
        </span>
      ))}
    </div>
  );
}
