/**
 * Client twin of backend/runograph_backend/analysis/run_filter.py.
 *
 * Wire form: "column:op:value[,value...]" — a filter list is an AND.
 * The two evaluators share golden test vectors (predicate.test.ts /
 * test_run_filter.py); change them in lockstep. `contains` folds ASCII letters
 * only, leaving non-ASCII code points exact for deterministic Python/JS parity.
 */

export type Op =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "eq"
  | "in"
  | "contains"
  | "absgte";

export type ColumnKind = "number" | "enum" | "string" | "boolean";

export interface Predicate {
  column: string;
  op: Op;
  values: string[];
}

export const KIND_OPS: Record<ColumnKind, Op[]> = {
  number: ["gt", "gte", "lt", "lte", "between", "eq", "absgte"],
  enum: ["eq", "in"],
  string: ["eq", "in", "contains"],
  boolean: ["eq"],
};

export const ROUTE_PSEUDO_OPS: Record<string, Op[]> = {
  "route.target": ["contains", "eq"],
  "route.event_type": ["eq", "in"],
  "route.edge": ["eq"],
};

export const EDGE_SEPARATOR = ">";
const DECIMAL_NUMBER_PATTERN =
  /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;

export function asciiFold(value: string): string {
  return value.replace(/[A-Z]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 32),
  );
}

const ALL_OPS = new Set<string>(Object.values(KIND_OPS).flat());
const SINGLE_VALUE_OPS = new Set<Op>([
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "absgte",
  "contains",
]);

export function parsePredicate(raw: string): Predicate {
  const i = raw.indexOf(":");
  const j = i === -1 ? -1 : raw.indexOf(":", i + 1);
  if (i === -1 || j === -1) {
    throw new Error(`filter '${raw}': expected column:op:value`);
  }
  const column = raw.slice(0, i);
  const op = raw.slice(i + 1, j);
  const valuePart = raw.slice(j + 1);
  if (!column) throw new Error(`filter '${raw}': empty column`);
  if (!ALL_OPS.has(op)) throw new Error(`filter '${raw}': unknown op '${op}'`);
  if (valuePart === "") throw new Error(`filter '${raw}': empty value`);
  const values = valuePart.split(",");
  if (values.some((v) => v === "")) {
    throw new Error(`filter '${raw}': empty value in list`);
  }
  if (SINGLE_VALUE_OPS.has(op as Op) && values.length !== 1) {
    throw new Error(`filter '${raw}': op '${op}' takes exactly one value`);
  }
  if (op === "between" && values.length !== 2) {
    throw new Error(`filter '${raw}': op '${op}' takes exactly two values`);
  }
  return { column, op: op as Op, values };
}

export function validatePredicate(
  p: Predicate,
  kinds: Record<string, ColumnKind>,
  allowRoutePseudo = false,
): void {
  const routeOps = allowRoutePseudo ? ROUTE_PSEUDO_OPS[p.column] : undefined;
  if (routeOps) {
    if (!routeOps.includes(p.op)) {
      throw new Error(`filter column '${p.column}': op '${p.op}' not allowed`);
    }
    if (p.column === "route.edge") {
      const parts = p.values[0]?.split(EDGE_SEPARATOR) ?? [];
      if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
        throw new Error("filter column 'route.edge': expected source>target");
      }
    }
    return;
  }

  const kind = kinds[p.column];
  if (!kind) throw new Error(`filter column '${p.column}': unknown column`);
  if (!KIND_OPS[kind].includes(p.op)) {
    throw new Error(`filter column '${p.column}' (${kind}): op '${p.op}' not allowed`);
  }
  if (
    kind === "number" &&
    p.values.some(
      (value) =>
        !DECIMAL_NUMBER_PATTERN.test(value) || !Number.isFinite(Number(value)),
    )
  ) {
    throw new Error(`filter column '${p.column}': non-numeric value`);
  }
  if (
    kind === "boolean" &&
    p.values.some((value) => !["true", "false", "1", "0"].includes(value.toLowerCase()))
  ) {
    throw new Error(`filter column '${p.column}': non-boolean value`);
  }
}

export function serializePredicate(p: Predicate): string {
  return `${p.column}:${p.op}:${p.values.join(",")}`;
}

export function predicatesEqual(a: Predicate, b: Predicate): boolean {
  return serializePredicate(a) === serializePredicate(b);
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") {
    return null;
  }
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function predicateMatches(
  rowValue: unknown,
  p: Predicate,
  kind: ColumnKind,
): boolean {
  if (kind === "number") {
    const v = toNumber(rowValue);
    const nums = p.values.map((x) => Number(x));
    if (v === null || nums.some((value) => !Number.isFinite(value))) return false;
    switch (p.op) {
      case "gt":
        return v > nums[0]!;
      case "gte":
        return v >= nums[0]!;
      case "lt":
        return v < nums[0]!;
      case "lte":
        return v <= nums[0]!;
      case "between": {
        const [lo, hi] = [Math.min(...nums), Math.max(...nums)];
        return v >= lo && v <= hi;
      }
      case "eq":
        return v === nums[0];
      case "absgte":
        return Math.abs(v) >= nums[0]!;
      default:
        return false;
    }
  }
  if (kind === "boolean") {
    const want = ["true", "1"].includes(p.values[0]!.toLowerCase());
    return Boolean(rowValue) === want;
  }
  const sval = String(rowValue ?? "");
  switch (p.op) {
    case "eq":
      return sval === p.values[0];
    case "in":
      return p.values.includes(sval);
    case "contains":
      return asciiFold(sval).includes(asciiFold(p.values[0]!));
    default:
      return false;
  }
}

/** AND-compile plain-column predicates into a row filter. Predicates on
 *  unknown columns never match (defensive; validation happens upstream). */
export function compilePredicates<T extends object>(
  preds: Predicate[],
  kinds: Record<string, ColumnKind>,
): (row: T) => boolean {
  return (row) =>
    preds.every((p) => {
      const kind = kinds[p.column];
      if (!kind) return false;
      return predicateMatches((row as Record<string, unknown>)[p.column], p, kind);
    });
}

/** Linear-interpolation percentile matching backend metrics._percentile.
 *  `values` need not be pre-sorted. */
export function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 1) return sorted[0]!;
  const idx = Math.max(0, Math.min(n - 1, (n - 1) * pct));
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower]!;
  const frac = idx - lower;
  return sorted[lower]! * (1 - frac) + sorted[upper]! * frac;
}
