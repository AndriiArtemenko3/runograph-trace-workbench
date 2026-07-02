import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { RowSelectionState } from "@tanstack/react-table";

import type { AsyncState } from "../api/routes";
import { useExperiments, useTableRows } from "../api/tables";
import type {
  ClusterRow,
  EdgeRow,
  RunRow,
  ScopeParams,
  StepRow,
} from "../api/tables";
import { DataTable, makeColumns } from "../components/DataTable";
import { kindsFromSpecs } from "../components/DataTable/columns";
import type { ColSpec } from "../components/DataTable/columns";
import { FilterBar, QuickChips, ScopeBar } from "../components/FilterBar";
import type { FilterColumn, QuickChip } from "../components/FilterBar";
import { TopBar } from "../components/TopBar";
import {
  compilePredicates,
  parsePredicate,
  percentile,
  serializePredicate,
} from "../filters/predicate";
import type { Predicate } from "../filters/predicate";
import { buildRouteIndex, isRoutePredicate, routePredicateMatches } from "../filters/routeIndex";
import type { RouteIndex } from "../filters/routeIndex";
import { RUN_ID_SCOPE_CAP, parseRunIds } from "../filters/scope";
import { useHashRoute } from "../router";
import type { SheetView } from "../router";

const SHEETS: SheetView[] = ["runs", "steps", "clusters", "edges"];

// Column specs — `kind` mirrors backend tables.COLUMN_KINDS.
const RUN_SPECS: ColSpec<RunRow>[] = [
  { key: "run_id", kind: "string" },
  { key: "outcome", kind: "enum" },
  { key: "cluster_id", kind: "enum" },
  { key: "total_tokens", kind: "number" },
  { key: "total_cost_usd", kind: "number" },
  { key: "latency_s", kind: "number" },
  { key: "event_count", kind: "number" },
  { key: "tool_call_count", kind: "number" },
  { key: "unique_targets", kind: "number" },
  { key: "error_count", kind: "number" },
  { key: "cost_usd_z", kind: "number" },
  { key: "tokens_total_z", kind: "number" },
  { key: "latency_s_z", kind: "number" },
  { key: "event_count_z", kind: "number" },
  { key: "distance_to_centroid", kind: "number" },
  { key: "is_representative", kind: "boolean" },
  { key: "model", kind: "enum" },
  { key: "task_id", kind: "string" },
];

const STEP_SPECS: ColSpec<StepRow>[] = [
  { key: "run_id", kind: "string" },
  { key: "seq_idx", kind: "number" },
  { key: "event_type", kind: "enum" },
  { key: "target", kind: "string" },
  { key: "tokens", kind: "number" },
  { key: "time_seconds", kind: "number" },
];

const CLUSTER_SPECS: ColSpec<ClusterRow>[] = [
  { key: "cluster_id", kind: "enum" },
  { key: "n_runs", kind: "number" },
  { key: "pass_rate", kind: "number" },
  { key: "error_rate", kind: "number" },
  { key: "representative_run_id", kind: "string" },
  ...(
    ["cost_usd", "tokens_total", "latency_s", "event_count"] as const
  ).flatMap((field) =>
    (["mean", "median", "p95", "std"] as const).map(
      (suffix) =>
        ({ key: `${field}_${suffix}`, kind: "number" }) as ColSpec<ClusterRow>,
    ),
  ),
];

const EDGE_SPECS: ColSpec<EdgeRow>[] = [
  { key: "source", kind: "string" },
  { key: "target", kind: "string" },
  { key: "count", kind: "number" },
  { key: "pass_count", kind: "number" },
  { key: "fail_count", kind: "number" },
  { key: "total_time_seconds", kind: "number" },
];

const RUN_COLUMNS = makeColumns(RUN_SPECS);
const STEP_COLUMNS = makeColumns(STEP_SPECS);
const CLUSTER_COLUMNS = makeColumns(CLUSTER_SPECS);
const EDGE_COLUMNS = makeColumns(EDGE_SPECS);

const RUN_KINDS = kindsFromSpecs(RUN_SPECS);
const STEP_KINDS = kindsFromSpecs(STEP_SPECS);
const CLUSTER_KINDS = kindsFromSpecs(CLUSTER_SPECS);
const EDGE_KINDS = kindsFromSpecs(EDGE_SPECS);

const ROUTE_FILTER_COLUMNS: FilterColumn[] = [
  { key: "route.target", kind: "string" },
  { key: "route.event_type", kind: "enum" },
  { key: "route.edge", kind: "string" },
];

const FILTER_COLUMNS: Record<SheetView, FilterColumn[]> = {
  runs: [
    ...RUN_SPECS.map((s) => ({ key: s.key, kind: s.kind ?? "string" }) as FilterColumn),
    ...ROUTE_FILTER_COLUMNS,
  ],
  steps: STEP_SPECS.map((s) => ({ key: s.key, kind: s.kind ?? "string" }) as FilterColumn),
  clusters: CLUSTER_SPECS.map((s) => ({ key: s.key, kind: s.kind ?? "string" }) as FilterColumn),
  edges: EDGE_SPECS.map((s) => ({ key: s.key, kind: s.kind ?? "string" }) as FilterColumn),
};

interface ParsedEntry {
  raw: string;
  pred: Predicate | null;
}

function parseEntries(raw: string[]): ParsedEntry[] {
  return raw.map((r) => {
    try {
      return { raw: r, pred: parsePredicate(r) };
    } catch {
      return { raw: r, pred: null };
    }
  });
}

function round6(v: number): string {
  return String(Math.round(v * 1e6) / 1e6);
}

function SheetState<T>({
  state,
  children,
}: {
  state: AsyncState<T[]>;
  children: (rows: T[]) => JSX.Element;
}) {
  if (state.status === "loading") {
    return <p className="font-mono text-sm text-text-tertiary">loading…</p>;
  }
  if (state.status === "error") {
    return <p className="font-mono text-sm text-status-danger">{state.error}</p>;
  }
  return children(state.data);
}

export function Workbench() {
  const [view, params, navigate, setParams] = useHashRoute();
  const experiments = useExperiments();
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [selection, setSelection] = useState<RowSelectionState>({});

  useEffect(() => {
    if (experimentId === null && experiments.status === "ready") {
      const first = experiments.data[0];
      if (first) setExperimentId(first.experiment_id);
    }
  }, [experiments, experimentId]);

  useEffect(() => setSelection({}), [experimentId]);

  // ----- filter + scope state (URL is the source of truth) -----
  const localEntries = useMemo(() => parseEntries(params.f), [params.f]);
  const localPreds = localEntries.flatMap((e) => (e.pred ? [e.pred] : []));
  const invalidLocal = localEntries.filter((e) => !e.pred).map((e) => e.raw);

  const scopeEntries = useMemo(() => parseEntries(params.s), [params.s]);
  const scopePreds = scopeEntries.flatMap((e) => (e.pred ? [e.pred] : []));
  const invalidScope = scopeEntries.filter((e) => !e.pred).map((e) => e.raw);
  const scopeRunIds = useMemo(() => parseRunIds(params.runs), [params.runs]);
  const scopeActive = scopePreds.length > 0 || scopeRunIds !== null;

  // ----- data -----
  const runsState = useTableRows<RunRow>("runs", experimentId);
  const routeNeeded =
    view === "steps" || [...localPreds, ...scopePreds].some(isRoutePredicate);
  const stepsState = useTableRows<StepRow>(
    "steps",
    routeNeeded ? experimentId : null,
  );
  const routeIdx: RouteIndex | null = useMemo(
    () => (stepsState.status === "ready" ? buildRouteIndex(stepsState.data) : null),
    [stepsState],
  );

  // ----- resolve scope run-id set client-side (runs/steps + ScopeBar) -----
  const scopeIds: Set<string> | null | "loading" = useMemo(() => {
    if (!scopeActive) return null;
    if (runsState.status !== "ready") return "loading";
    const plainScope = scopePreds.filter((p) => !isRoutePredicate(p));
    const routeScope = scopePreds.filter(isRoutePredicate);
    if (routeScope.length > 0 && !routeIdx) return "loading";
    const match = compilePredicates<RunRow>(plainScope, RUN_KINDS);
    let ids = runsState.data.filter(match).map((r) => r.run_id);
    if (routeIdx && routeScope.length > 0) {
      ids = ids.filter((id) =>
        routeScope.every((p) => routePredicateMatches(routeIdx, id, p)),
      );
    }
    if (scopeRunIds) {
      const whitelist = new Set(scopeRunIds);
      ids = ids.filter((id) => whitelist.has(id));
    }
    return new Set(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeActive, runsState, routeIdx, params.s, params.runs]);

  // ----- handlers -----
  const setLocalPreds = (preds: Predicate[]) =>
    setParams({ f: preds.map(serializePredicate) });

  const pinFiltersAsScope = () =>
    setParams({ s: [...params.s, ...localPreds.map(serializePredicate)], f: [] });

  const selectedIds = Object.entries(selection)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const scopeToSelection = () => {
    setParams({ runs: selectedIds.join(",") });
    setSelection({});
  };

  const validScopeRawIndexes = scopeEntries
    .map((e, i) => (e.pred ? i : -1))
    .filter((i) => i >= 0);

  const serverScope: ScopeParams | undefined = scopeActive
    ? { s: scopePreds.map(serializePredicate), runs: params.runs }
    : undefined;

  // ----- per-sheet client filtering -----
  const localPlain = localPreds.filter((p) => !isRoutePredicate(p));
  const localRoute = localPreds.filter(isRoutePredicate);

  const runsRows: RunRow[] | null = useMemo(() => {
    if (runsState.status !== "ready" || scopeIds === "loading") return null;
    if (localRoute.length > 0 && !routeIdx) return null;
    let rows = runsState.data;
    if (scopeIds instanceof Set) rows = rows.filter((r) => scopeIds.has(r.run_id));
    rows = rows.filter(compilePredicates<RunRow>(localPlain, RUN_KINDS));
    if (routeIdx && localRoute.length > 0) {
      rows = rows.filter((r) =>
        localRoute.every((p) => routePredicateMatches(routeIdx, r.run_id, p)),
      );
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runsState, scopeIds, routeIdx, params.f]);

  const runChips: QuickChip[] = useMemo(() => {
    const chips: QuickChip[] = [
      { label: "pass", mergeColumn: "outcome", mergeValue: "pass" },
      { label: "fail", mergeColumn: "outcome", mergeValue: "fail" },
      { label: "error", mergeColumn: "outcome", mergeValue: "error" },
    ];
    if (runsState.status === "ready" && runsState.data.length > 0) {
      const clusterIds = [...new Set(runsState.data.map((r) => r.cluster_id))].sort(
        (a, b) => a - b,
      );
      for (const cid of clusterIds) {
        chips.push({
          label: `c${cid}`,
          mergeColumn: "cluster_id",
          mergeValue: String(cid),
        });
      }
      const p95Cols = [
        ["total_cost_usd", "cost≥p95"],
        ["total_tokens", "tokens≥p95"],
        ["latency_s", "latency≥p95"],
      ] as const;
      for (const [col, label] of p95Cols) {
        const p95 = percentile(runsState.data.map((r) => Number(r[col])), 0.95);
        chips.push({ label, pred: { column: col, op: "gte", values: [round6(p95)] } });
      }
      for (const col of [
        "cost_usd_z",
        "tokens_total_z",
        "latency_s_z",
        "event_count_z",
      ] as const) {
        chips.push({
          label: `|${col.replace("_z", "")} z|≥2`,
          pred: { column: col, op: "absgte", values: ["2"] },
        });
      }
    }
    return chips;
  }, [runsState]);

  const [groupByCluster, setGroupByCluster] = useState(false);

  return (
    <div className="min-h-screen bg-bg-canvas text-text-primary">
      <TopBar
        experiments={experiments.status === "ready" ? experiments.data : []}
        selected={experimentId}
        onSelect={(id) => {
          setParams({ f: [], s: [], runs: null });
          setExperimentId(id);
        }}
      />
      <nav className="flex gap-1 border-b border-border-hairline bg-bg-panel px-6">
        {SHEETS.map((sheet) => (
          <button
            key={sheet}
            onClick={() => navigate(sheet)}
            className={clsx(
              "border-b-2 px-3 py-2 font-mono text-sm",
              sheet === view
                ? "border-accent-primary text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary",
            )}
          >
            {sheet}
          </button>
        ))}
      </nav>
      <ScopeBar
        predicates={scopePreds}
        invalid={invalidScope}
        runIds={scopeRunIds}
        matchedCount={scopeIds instanceof Set ? scopeIds.size : null}
        onRemovePredicate={(vi) =>
          setParams({
            s: params.s.filter((_, ri) => ri !== validScopeRawIndexes[vi]),
          })
        }
        onClearSelection={() => setParams({ runs: null })}
        onClearAll={() => setParams({ s: [], runs: null })}
      />
      <main className="p-6">
        {experimentId === null ? (
          <p className="font-mono text-sm text-text-tertiary">
            loading experiments…
          </p>
        ) : (
          <>
            <FilterBar
              columns={FILTER_COLUMNS[view]}
              predicates={localPreds}
              invalid={invalidLocal}
              onChange={setLocalPreds}
            />
            {view === "runs" && (
              <>
                <QuickChips
                  chips={runChips}
                  predicates={localPreds}
                  onChange={setLocalPreds}
                />
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <label className="flex w-fit cursor-pointer items-center gap-2 font-mono text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={groupByCluster}
                      onChange={(e) => setGroupByCluster(e.target.checked)}
                    />
                    group by cluster
                  </label>
                  <button
                    onClick={pinFiltersAsScope}
                    disabled={localPreds.length === 0}
                    className="rounded border border-border-subtle px-2 py-1 font-mono text-xs text-text-secondary enabled:hover:text-text-primary disabled:opacity-40"
                  >
                    pin filters as scope
                  </button>
                  <button
                    onClick={scopeToSelection}
                    disabled={
                      selectedIds.length === 0 ||
                      selectedIds.length > RUN_ID_SCOPE_CAP
                    }
                    title={
                      selectedIds.length > RUN_ID_SCOPE_CAP
                        ? `selection over ${RUN_ID_SCOPE_CAP} — use filters for large sets`
                        : undefined
                    }
                    className="rounded border border-border-subtle px-2 py-1 font-mono text-xs text-text-secondary enabled:hover:text-text-primary disabled:opacity-40"
                  >
                    scope to {selectedIds.length} selected
                  </button>
                </div>
                {runsRows === null ? (
                  <p className="font-mono text-sm text-text-tertiary">loading…</p>
                ) : (
                  <DataTable
                    data={runsRows}
                    columns={RUN_COLUMNS}
                    grouping={groupByCluster ? ["cluster_id"] : []}
                    rowSelection={selection}
                    onRowSelectionChange={setSelection}
                    getRowId={(r) => r.run_id}
                  />
                )}
              </>
            )}
            {view === "steps" && (
              <SheetState state={stepsState}>
                {(rows) => {
                  if (scopeIds === "loading") {
                    return (
                      <p className="font-mono text-sm text-text-tertiary">loading…</p>
                    );
                  }
                  let out = rows;
                  if (scopeIds instanceof Set) {
                    out = out.filter((r) => scopeIds.has(r.run_id));
                  }
                  out = out.filter(compilePredicates<StepRow>(localPlain, STEP_KINDS));
                  return <DataTable data={out} columns={STEP_COLUMNS} />;
                }}
              </SheetState>
            )}
            {view === "clusters" && (
              <ScopedServerSheet<ClusterRow>
                sheet="clusters"
                experimentId={experimentId}
                scope={serverScope}
                columns={CLUSTER_COLUMNS}
                localFilter={compilePredicates<ClusterRow>(localPlain, CLUSTER_KINDS)}
              />
            )}
            {view === "edges" && (
              <ScopedServerSheet<EdgeRow>
                sheet="edges"
                experimentId={experimentId}
                scope={serverScope}
                columns={EDGE_COLUMNS}
                localFilter={compilePredicates<EdgeRow>(localPlain, EDGE_KINDS)}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ScopedServerSheet<T extends object>({
  sheet,
  experimentId,
  scope,
  columns,
  localFilter,
}: {
  sheet: SheetView;
  experimentId: string;
  scope: ScopeParams | undefined;
  columns: ReturnType<typeof makeColumns<T>>;
  localFilter: (row: T) => boolean;
}) {
  const state = useTableRows<T>(sheet, experimentId, scope);
  return (
    <SheetState state={state}>
      {(rows) => <DataTable data={rows.filter(localFilter)} columns={columns} />}
    </SheetState>
  );
}
