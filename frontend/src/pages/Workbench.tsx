import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import type { OnChangeFn, RowSelectionState } from "@tanstack/react-table";

import type { AsyncState } from "../api/routes";
import { useExperiments, useTableRows } from "../api/tables";
import type {
  ClusterRow,
  EdgeRow,
  RunRow,
  ScopeParams,
  StepRow,
} from "../api/tables";
import {
  AsyncBoundary,
  AsyncCollection,
  StateNotice,
} from "../components/AsyncState";
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
  validatePredicate,
} from "../filters/predicate";
import type { Predicate } from "../filters/predicate";
import {
  buildRouteIndex,
  isRoutePredicate,
  routePredicateMatches,
} from "../filters/routeIndex";
import type { RouteIndex } from "../filters/routeIndex";
import {
  RUN_ID_SCOPE_CAP,
  isPublicId,
  parseRunIds,
} from "../filters/scope";
import { useHashRoute } from "../router";
import type { SheetView } from "../router";

const SHEETS: SheetView[] = ["runs", "steps", "clusters", "edges"];

// Column specs — `kind` mirrors backend tables.COLUMN_KINDS.
const RUN_SPECS: ColSpec<RunRow>[] = [
  { key: "run_id", kind: "string" },
  { key: "outcome", kind: "enum" },
  { key: "outcome_source", kind: "enum" },
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
  { key: "outcome_label_source", kind: "enum" },
  { key: "reported_pass_rate", kind: "number" },
  { key: "reported_error_rate", kind: "number" },
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
  { key: "outcome_label_source", kind: "enum" },
  { key: "reported_pass_count", kind: "number" },
  { key: "reported_fail_count", kind: "number" },
  { key: "reported_error_count", kind: "number" },
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

function parseEntries(
  raw: string[],
  kinds: Record<string, FilterColumn["kind"]>,
  allowRoutePseudo = false,
): ParsedEntry[] {
  return raw.map((r) => {
    try {
      const pred = parsePredicate(r);
      validatePredicate(pred, kinds, allowRoutePseudo);
      return { raw: r, pred };
    } catch {
      return { raw: r, pred: null };
    }
  });
}

function round6(v: number): string {
  return String(Math.round(v * 1e6) / 1e6);
}

export function Workbench() {
  const [view, params, navigate, setParams, replaceParams] = useHashRoute();
  const experiments = useExperiments();
  const [selection, setSelection] = useState<RowSelectionState>({});
  const hasScopedHashParams =
    params.f.length > 0 || params.s.length > 0 || params.runs !== null;

  const experimentId = useMemo(() => {
    if (experiments.status !== "ready") return null;
    if (params.experiment === null) {
      return experiments.data[0]?.experiment_id ?? null;
    }
    if (!isPublicId(params.experiment)) return null;
    return experiments.data.find(
      (experiment) => experiment.experiment_id === params.experiment,
    )?.experiment_id ?? null;
  }, [experiments, params.experiment]);

  useEffect(() => {
    if (
      experiments.status === "ready" &&
      params.experiment === null &&
      experimentId !== null &&
      !hasScopedHashParams
    ) {
      replaceParams({ experiment: experimentId });
    }
  }, [
    experimentId,
    experiments.status,
    hasScopedHashParams,
    params.experiment,
    replaceParams,
  ]);

  useEffect(() => setSelection({}), [experimentId]);

  // ----- filter + scope state (URL is the source of truth) -----
  const localKinds =
    view === "runs"
      ? RUN_KINDS
      : view === "steps"
        ? STEP_KINDS
        : view === "clusters"
          ? CLUSTER_KINDS
          : EDGE_KINDS;
  const localEntries = useMemo(
    () => parseEntries(params.f, localKinds, view === "runs"),
    [localKinds, params.f, view],
  );
  const localPreds = localEntries.flatMap((e) => (e.pred ? [e.pred] : []));
  const invalidLocal = localEntries.filter((e) => !e.pred).map((e) => e.raw);

  const scopeEntries = useMemo(
    () => parseEntries(params.s, RUN_KINDS, true),
    [params.s],
  );
  const scopePreds = scopeEntries.flatMap((e) => (e.pred ? [e.pred] : []));
  const invalidScope = scopeEntries.filter((e) => !e.pred).map((e) => e.raw);
  const parsedRunIds = useMemo(() => {
    try {
      return { ids: parseRunIds(params.runs), error: null };
    } catch (error: unknown) {
      return {
        ids: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [params.runs]);
  const scopeRunIds = parsedRunIds.ids;
  const scopeActive = scopePreds.length > 0 || scopeRunIds !== null;

  const experimentError =
    experiments.status === "ready" &&
    params.experiment !== null &&
    experimentId === null
      ? `unknown or invalid experiment '${params.experiment}'`
      : null;
  const missingExperimentError =
    params.experiment === null && hasScopedHashParams
      ? "an experiment is required when filter or run scope is present"
      : null;
  const contractIssues = [
    experimentError,
    missingExperimentError,
    ...invalidLocal.map((raw) => `invalid filter '${raw}'`),
    ...invalidScope.map((raw) => `invalid scope '${raw}'`),
    parsedRunIds.error,
  ].filter((issue): issue is string => issue !== null);
  const contractInvalid = contractIssues.length > 0;
  const dataExperimentId = contractInvalid ? null : experimentId;

  // ----- data -----
  const runsState = useTableRows<RunRow>("runs", dataExperimentId);
  const routeNeeded =
    view === "steps" || [...localPreds, ...scopePreds].some(isRoutePredicate);
  const stepsState = useTableRows<StepRow>(
    "steps",
    routeNeeded ? dataExperimentId : null,
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
  const unsafeSelectedIds = selectedIds.filter((runId) => !isPublicId(runId));

  const scopeToSelection = () => {
    if (unsafeSelectedIds.length > 0) return;
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
      { label: "reported pass", mergeColumn: "outcome", mergeValue: "pass" },
      { label: "reported fail", mergeColumn: "outcome", mergeValue: "fail" },
      { label: "reported error", mergeColumn: "outcome", mergeValue: "error" },
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
        const values = runsState.data
          .map((row) => row[col])
          .filter((value): value is number => value !== null);
        if (values.length > 0) {
          const p95 = percentile(values, 0.95);
          chips.push({
            label,
            pred: { column: col, op: "gte", values: [round6(p95)] },
          });
        }
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
        emptyLabel={
          experiments.status === "loading"
            ? "Loading experiments…"
            : experiments.status === "error"
              ? "Experiments unavailable"
              : "No experiments"
        }
        onSelect={(id) => {
          setParams({ experiment: id, f: [], s: [], runs: null });
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
        <AsyncCollection
          state={experiments}
          label="experiments"
          loadingTitle="Loading experiments…"
          errorTitle="Unable to load experiments"
          errorDetail="The Workbench could not reach the experiments API. Check that the service is running, then retry."
          emptyTitle="No experiments found"
          emptyDetail="The API is available, but it returned no experiments. Add or import experiment data, then refresh."
        >
          {() =>
            contractInvalid ? (
              <StateNotice
                tone="error"
                title="Invalid workbench URL"
                detail="The experiment, filter, or scope contract is invalid. Fix or clear the hash parameters; no trace rows were requested."
                diagnostic={contractIssues.join("; ")}
              />
            ) : experimentId === null ? (
              <StateNotice
                tone="empty"
                title="No experiment selected"
                detail="Choose an experiment to open the Workbench."
              />
            ) : (
              <>
                <p className="mb-3 font-mono text-xs text-text-secondary">
                  Outcomes, token totals, costs, and timestamps are stored
                  metadata. Source fields distinguish current external imports
                  from unknown legacy provenance; RunoGraph verifies neither.
                </p>
                <FilterBar
                  key={view}
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
                          selectedIds.length > RUN_ID_SCOPE_CAP ||
                          unsafeSelectedIds.length > 0
                        }
                        title={
                          unsafeSelectedIds.length > 0
                            ? "legacy run IDs cannot be encoded in URL scope — export and re-ingest them under safe IDs"
                            : selectedIds.length > RUN_ID_SCOPE_CAP
                            ? `selection over ${RUN_ID_SCOPE_CAP} — use filters for large sets`
                            : undefined
                        }
                        className="rounded border border-border-subtle px-2 py-1 font-mono text-xs text-text-secondary enabled:hover:text-text-primary disabled:opacity-40"
                      >
                        scope to {selectedIds.length} selected
                      </button>
                      {unsafeSelectedIds.length > 0 && (
                        <span className="font-mono text-xs text-status-danger">
                          Selected legacy run IDs cannot be URL-scoped; export
                          and re-ingest them under safe IDs.
                        </span>
                      )}
                    </div>
                    <RunsSheet
                      state={runsState}
                      routeState={routeNeeded ? stepsState : null}
                      rows={runsRows}
                      grouping={groupByCluster ? ["cluster_id"] : []}
                      selection={selection}
                      onSelectionChange={setSelection}
                    />
                  </>
                )}
                {view === "steps" && (
                  <StepsSheet
                    state={stepsState}
                    scopeDependency={scopeActive ? runsState : null}
                    scopeIds={scopeIds}
                    localFilter={compilePredicates<StepRow>(
                      localPlain,
                      STEP_KINDS,
                    )}
                  />
                )}
                {view === "clusters" && (
                  <ScopedServerSheet<ClusterRow>
                    sheet="clusters"
                    experimentId={experimentId}
                    scope={serverScope}
                    columns={CLUSTER_COLUMNS}
                    localFilter={compilePredicates<ClusterRow>(
                      localPlain,
                      CLUSTER_KINDS,
                    )}
                  />
                )}
                {view === "edges" && (
                  <ScopedServerSheet<EdgeRow>
                    sheet="edges"
                    experimentId={experimentId}
                    scope={serverScope}
                    columns={EDGE_COLUMNS}
                    localFilter={compilePredicates<EdgeRow>(
                      localPlain,
                      EDGE_KINDS,
                    )}
                  />
                )}
              </>
            )
          }
        </AsyncCollection>
      </main>
    </div>
  );
}

export function RunsSheet({
  state,
  routeState,
  rows,
  grouping,
  selection,
  onSelectionChange,
}: {
  state: AsyncState<RunRow[]>;
  routeState: AsyncState<StepRow[]> | null;
  rows: RunRow[] | null;
  grouping: string[];
  selection: RowSelectionState;
  onSelectionChange: OnChangeFn<RowSelectionState>;
}) {
  return (
    <AsyncCollection
      state={state}
      label="runs"
      emptyTitle="No runs found"
      emptyDetail="This experiment has no run rows yet. Refresh after data is available."
    >
      {() => {
        const content =
          rows === null ? (
            <StateNotice tone="loading" title="Preparing runs…" />
          ) : rows.length === 0 ? (
            <StateNotice
              tone="empty"
              title="No runs match the current view"
              detail="Adjust or clear the current filters and scope to see runs."
            />
          ) : (
            <DataTable
              data={rows}
              columns={RUN_COLUMNS}
              grouping={grouping}
              rowSelection={selection}
              onRowSelectionChange={onSelectionChange}
              getRowId={(row) => row.run_id}
            />
          );

        return routeState ? (
          <AsyncBoundary
            state={routeState}
            label="route data"
            errorDetail="Route-based filters need step data from the API. Retry the request without changing the current sheet or scope."
          >
            {() => content}
          </AsyncBoundary>
        ) : (
          content
        );
      }}
    </AsyncCollection>
  );
}

export function StepsSheet({
  state,
  scopeDependency,
  scopeIds,
  localFilter,
}: {
  state: AsyncState<StepRow[]>;
  scopeDependency: AsyncState<RunRow[]> | null;
  scopeIds: Set<string> | null | "loading";
  localFilter: (row: StepRow) => boolean;
}) {
  return (
    <AsyncCollection
      state={state}
      label="steps"
      emptyTitle="No steps found"
      emptyDetail="This experiment has no step rows yet. Refresh after data is available."
    >
      {(rows) => {
        const content = (() => {
          if (scopeIds === "loading") {
            return <StateNotice tone="loading" title="Resolving run scope…" />;
          }
          let filtered = rows;
          if (scopeIds instanceof Set) {
            filtered = filtered.filter((row) => scopeIds.has(row.run_id));
          }
          filtered = filtered.filter(localFilter);
          return filtered.length === 0 ? (
            <StateNotice
              tone="empty"
              title="No steps match the current view"
              detail="Adjust or clear the current filters and scope to see steps."
            />
          ) : (
            <DataTable data={filtered} columns={STEP_COLUMNS} />
          );
        })();

        return scopeDependency ? (
          <AsyncBoundary
            state={scopeDependency}
            label="run scope"
            errorDetail="The selected scope depends on run data from the API. Retry to resolve it without changing the current sheet."
          >
            {() => content}
          </AsyncBoundary>
        ) : (
          content
        );
      }}
    </AsyncCollection>
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
    <AsyncCollection
      state={state}
      label={sheet}
      emptyTitle={`No ${sheet} found`}
      emptyDetail={
        scope
          ? `No ${sheet} data match the current experiment and scope. Refresh after data or scope changes.`
          : `This experiment has no ${sheet} data yet. Refresh after data is available.`
      }
    >
      {(rows) => {
        const filtered = rows.filter(localFilter);
        return filtered.length === 0 ? (
          <StateNotice
            tone="empty"
            title={`No ${sheet} match the current filters`}
            detail="Adjust or clear the sheet filters to see rows."
          />
        ) : (
          <DataTable data={filtered} columns={columns} />
        );
      }}
    </AsyncCollection>
  );
}
