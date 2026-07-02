import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type {
  ColumnDef,
  ExpandedState,
  OnChangeFn,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table";
import { clsx } from "clsx";

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  /** Column ids to group by (e.g. ["cluster_id"]); empty = flat table. */
  grouping?: string[];
  /** Providing selection props adds a leading checkbox column. */
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  getRowId?: (row: T) => string;
}

/**
 * Generic sortable/filterable table over TanStack Table. Click a header to
 * sort; the text box filters across all columns; optional grouping renders
 * collapsible group rows. Numeric columns declare `meta: { numeric: true }`
 * for right-aligned mono rendering.
 */
export function DataTable<T>({
  data,
  columns,
  grouping = [],
  rowSelection,
  onRowSelectionChange,
  getRowId,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const selectable = onRowSelectionChange !== undefined;
  const allColumns: ColumnDef<T, unknown>[] = selectable
    ? [
        {
          id: "_select",
          header: ({ table }) => (
            <input
              type="checkbox"
              checked={table.getIsAllRowsSelected()}
              onChange={table.getToggleAllRowsSelectedHandler()}
            />
          ),
          cell: ({ row }) => (
            <input
              type="checkbox"
              checked={row.getIsSelected()}
              onChange={row.getToggleSelectedHandler()}
            />
          ),
          enableSorting: false,
        },
        ...columns,
      ]
    : columns;

  const table = useReactTable({
    data,
    columns: allColumns,
    state: {
      sorting,
      globalFilter,
      expanded,
      grouping,
      rowSelection: rowSelection ?? {},
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onExpandedChange: setExpanded,
    onRowSelectionChange,
    enableRowSelection: selectable,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    globalFilterFn: "includesString",
    autoResetExpanded: false,
  });

  const rows = table.getRowModel().rows;

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="filter…"
          className="w-64 rounded border border-border-hairline bg-bg-sunken px-2 py-1 font-mono text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-strong focus:outline-none"
        />
        <span className="font-mono text-xs text-text-tertiary">
          {table.getFilteredRowModel().rows.length} rows
        </span>
      </div>
      <div className="overflow-auto rounded border border-border-hairline">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-bg-elevated">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className={clsx(
                      "cursor-pointer select-none whitespace-nowrap border-b border-border-subtle px-3 py-2 text-left font-mono text-xs text-text-secondary hover:text-text-primary",
                      header.column.columnDef.meta?.numeric && "text-right",
                    )}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: " ▲", desc: " ▼" }[
                      header.column.getIsSorted() as string
                    ] ?? ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.id}
                className={clsx(
                  row.getIsGrouped()
                    ? "bg-bg-elevated"
                    : i % 2 === 0
                      ? "bg-bg-panel"
                      : "bg-bg-canvas",
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  if (cell.getIsGrouped()) {
                    return (
                      <td key={cell.id} className="px-3 py-1.5">
                        <button
                          onClick={row.getToggleExpandedHandler()}
                          className="font-mono text-xs text-text-primary"
                        >
                          {row.getIsExpanded() ? "▾" : "▸"}{" "}
                          {String(cell.getValue())}{" "}
                          <span className="text-text-tertiary">
                            ({row.subRows.length})
                          </span>
                        </button>
                      </td>
                    );
                  }
                  if (cell.getIsAggregated() || cell.getIsPlaceholder()) {
                    return <td key={cell.id} className="px-3 py-1.5" />;
                  }
                  return (
                    <td
                      key={cell.id}
                      className={clsx(
                        "whitespace-nowrap px-3 py-1.5 font-mono text-xs text-text-primary",
                        cell.column.columnDef.meta?.numeric && "text-right",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
