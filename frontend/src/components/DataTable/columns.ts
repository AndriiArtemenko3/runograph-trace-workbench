import type { ColumnDef, RowData } from "@tanstack/react-table";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    numeric?: boolean;
  }
}

/** Declarative column spec — key doubles as the header so the UI reads
 *  exactly like the CSV export. */
export interface ColSpec<T> {
  key: keyof T & string;
  numeric?: boolean;
}

export function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "✓" : "";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(Math.abs(v) < 1 ? 4 : 2);
  }
  return String(v);
}

export function makeColumns<T>(specs: ColSpec<T>[]): ColumnDef<T, unknown>[] {
  return specs.map((spec) => ({
    accessorKey: spec.key,
    header: spec.key,
    cell: (ctx) => fmtCell(ctx.getValue()),
    meta: { numeric: spec.numeric ?? false },
  }));
}
