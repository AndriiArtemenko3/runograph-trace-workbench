import { useMemo, useState } from "react";
import clsx from "clsx";
import { AppShell } from "./AppShell";
import { HeatTile } from "../components/HeatTile";
import { LeftPane, type LeftPaneSection } from "../components/composites/LeftPane";
import type { BottomBarEntry } from "../components/composites/BottomBar";
import {
  useHeatMap,
  type HeatDistrict,
  type HeatMapResponse,
  type HeatTileData,
  type AgentPathStep,
} from "../api/heatmap";

/**
 * Heat-map page — corpus tile-grid view.
 *
 * Bit-locked to Figma page 04 Heat-map exploration, variant B (tile
 * grid). 7 districts × 4-24 tiles each, rendered as a 32×32 HeatTile
 * grid per district. The agent's 5-step path overlays numbered badges
 * onto the tiles it touched.
 *
 * Data flow: GET /api/v1/heatmap → useHeatMap → HeatMap. Tile hover/
 * click flips the right-pane detail card.
 */

const ACTION_TONE: Record<AgentPathStep["action"], string> = {
  read: "bg-status-info text-bg-canvas",
  retrieved: "bg-accent-primary text-bg-canvas",
  edited: "bg-status-success text-bg-canvas",
  "test-failed": "bg-status-danger text-bg-canvas",
};

function DistrictCard({
  district,
  pathByTileId,
  selectedTileId,
  onTileSelect,
}: {
  district: HeatDistrict;
  pathByTileId: Map<string, AgentPathStep>;
  selectedTileId: string | null;
  onTileSelect: (tile: HeatTileData) => void;
}) {
  return (
    <article
      className="rounded-md bg-bg-panel border border-border-hairline p-2"
      data-district={district.id}
    >
      <header className="flex items-center justify-between px-1 pb-1.5">
        <h3 className="font-sans text-xs font-medium text-text-primary truncate">
          {district.name}
          <span className="ml-2 text-text-tertiary font-mono">
            · {district.fileCount} files
          </span>
        </h3>
        <span
          className={clsx(
            "font-mono text-xs tabular-nums",
            district.evTotal.startsWith("−")
              ? "text-heat-pollution-500"
              : district.evTotal === "+0.00"
                ? "text-text-tertiary"
                : "text-heat-productivity-500",
          )}
        >
          {district.evTotal}
        </span>
      </header>
      <div className="flex flex-wrap gap-1">
        {district.tiles.map((t) => {
          const step = pathByTileId.get(t.id);
          const isSelected = t.id === selectedTileId;
          return (
            <div key={t.id} className="relative">
              <HeatTile
                productivity={t.productivity}
                pollution={t.pollution}
                label={`${t.filename} · prod:${t.productivity} · poll:${t.pollution}`}
                onClick={() => onTileSelect(t)}
                className={clsx(
                  isSelected && "ring-2 ring-accent-primary ring-offset-1 ring-offset-bg-panel",
                )}
              />
              {step ? (
                <span
                  aria-hidden="true"
                  className={clsx(
                    "absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full",
                    "flex items-center justify-center",
                    "font-mono text-2xs font-medium leading-none",
                    ACTION_TONE[step.action],
                  )}
                  data-step={step.step}
                >
                  {step.step}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </article>
  );
}

function HeatMapLegend() {
  return (
    <section
      aria-label="Legend"
      className="rounded-md bg-bg-panel border border-border-hairline p-3 flex flex-col gap-2 text-text-secondary text-xs"
    >
      <div>
        <div className="text-text-primary font-medium mb-1">
          Productivity · helped agent reach +EV
        </div>
        <div className="flex items-center gap-1">
          {(["low", "med", "high"] as const).map((p) => (
            <HeatTile key={`p-${p}`} productivity={p} pollution="low" className="!h-5 !w-5" />
          ))}
        </div>
      </div>
      <div>
        <div className="text-text-primary font-medium mb-1">
          Pollution · caused failure-class events
        </div>
        <div className="flex items-center gap-1">
          {(["low", "med", "high"] as const).map((p) => (
            <HeatTile key={`pp-${p}`} productivity="low" pollution={p} className="!h-5 !w-5" />
          ))}
        </div>
      </div>
      <div className="text-text-tertiary text-2xs">
        Contested = high productivity AND high pollution (worth opening).
      </div>
    </section>
  );
}

function AgentPathList({
  steps,
  tilesById,
  onStepClick,
}: {
  steps: AgentPathStep[];
  tilesById: Map<string, HeatTileData>;
  onStepClick: (tile: HeatTileData) => void;
}) {
  return (
    <section
      aria-label="Agent path"
      className="rounded-md bg-bg-panel border border-border-hairline p-3 flex flex-col gap-2"
    >
      <h3 className="text-text-secondary text-xs font-mono uppercase tracking-wide pb-1">
        Agent path · {steps.length} steps
      </h3>
      <ol className="flex flex-col gap-1.5 m-0 p-0 list-none">
        {steps.map((step) => {
          const tile = tilesById.get(step.tileId);
          return (
            <li key={step.step} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className={clsx(
                  "shrink-0 h-5 min-w-5 px-1.5 rounded-full",
                  "flex items-center justify-center",
                  "font-mono text-2xs font-medium leading-none",
                  ACTION_TONE[step.action],
                )}
              >
                {step.step}
              </span>
              <button
                type="button"
                onClick={() => tile && onStepClick(tile)}
                className="text-left min-w-0 flex-1 hover:text-text-primary text-text-secondary"
              >
                <span className="block truncate font-mono text-xs">
                  {tile?.filename ?? step.tileId}
                </span>
                <span className="block text-text-tertiary text-2xs">
                  {step.action}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SelectedTileCard({ tile }: { tile: HeatTileData | null }) {
  if (!tile) {
    return (
      <section
        aria-label="Selected tile"
        className="rounded-md bg-bg-elevated border border-dashed border-border-subtle p-3 text-text-tertiary text-xs font-mono"
      >
        Click a tile to inspect — read count, retrievals, EV contribution.
      </section>
    );
  }
  return (
    <section
      aria-label="Selected tile"
      className="rounded-md bg-bg-panel border border-border-hairline p-3 flex flex-col gap-2"
    >
      <header className="flex items-start gap-2">
        <HeatTile
          productivity={tile.productivity}
          pollution={tile.pollution}
          label={tile.filename}
        />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs text-text-primary break-all leading-snug">
            {tile.filename}
          </div>
          <div className="text-text-tertiary text-2xs">prod {tile.productivity} · poll {tile.pollution}</div>
        </div>
      </header>
      <dl className="grid grid-cols-3 gap-2 text-2xs">
        <div className="flex flex-col">
          <dt className="text-text-tertiary uppercase">Reads</dt>
          <dd className="text-text-primary font-mono tabular-nums">{tile.reads}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-text-tertiary uppercase">Retrievals</dt>
          <dd className="text-text-primary font-mono tabular-nums">{tile.retrievals}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-text-tertiary uppercase">EV Δ</dt>
          <dd
            className={clsx(
              "font-mono tabular-nums",
              tile.evContribution.startsWith("−")
                ? "text-heat-pollution-500"
                : tile.evContribution === "+0.00"
                  ? "text-text-secondary"
                  : "text-heat-productivity-500",
            )}
          >
            {tile.evContribution}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function buildLeftPaneSections(data: HeatMapResponse): LeftPaneSection[] {
  return [
    {
      title: "Districts",
      rows: data.districts.map((d) => ({
        label: d.name,
        value: d.evTotal,
      })),
    },
  ];
}

function buildBottomBarEntries(
  data: HeatMapResponse | null,
): { left: BottomBarEntry[]; right: BottomBarEntry[] } {
  const tileCount =
    data?.districts.reduce((acc, d) => acc + d.tiles.length, 0) ?? 0;
  return {
    left: [
      {
        tone: "info",
        label: "corpus",
        detail: data ? `${data.corpus} · ${tileCount} tiles` : "—",
      },
      {
        tone: "info",
        label: "agent path",
        detail: data ? `${data.agentPath.length} steps` : "—",
      },
      {
        tone: "success",
        label: data ? data.harness : "—",
        detail: data ? `${data.compositeEv} composite` : "",
      },
    ],
    right: [
      { tone: "success", label: "workers 8/8", detail: "p50 1.4s · p95 5.2s" },
      { tone: "success", label: "v0.3-alpha", detail: "14:22" },
    ],
  };
}

export function HeatMap() {
  const state = useHeatMap();
  const [selectedTile, setSelectedTile] = useState<HeatTileData | null>(null);

  const { pathByTileId, tilesById } = useMemo(() => {
    if (state.status !== "ready") {
      return { pathByTileId: new Map(), tilesById: new Map() };
    }
    const path = new Map<string, AgentPathStep>(
      state.data.agentPath.map((s) => [s.tileId, s]),
    );
    const tiles = new Map<string, HeatTileData>();
    for (const d of state.data.districts) {
      for (const t of d.tiles) tiles.set(t.id, t);
    }
    return { pathByTileId: path, tilesById: tiles };
  }, [state]);

  const bottomEntries = buildBottomBarEntries(
    state.status === "ready" ? state.data : null,
  );

  return (
    <AppShell
      crumb="/ 04 Heat-map"
      pageTitle="RunoGraph Heat-map"
      weightProfile="balanced"
      bottomLeft={bottomEntries.left}
      bottomRight={bottomEntries.right}
    >
      {state.status === "ready" ? (
        <>
          <LeftPane sections={buildLeftPaneSections(state.data)} />
          <section
            className="flex-1 min-w-0 bg-bg-canvas flex flex-col overflow-auto"
            data-canon="centerpane-51:8"
          >
            <div className="px-4 pt-4 pb-3">
              <h2 className="font-sans text-lg font-medium text-text-primary">
                Heat-map · tile grid
              </h2>
              <p className="text-text-secondary text-sm">
                Corpus {state.data.corpus} · {state.data.harness} ·{" "}
                <span className="text-text-primary">{state.data.compositeEv}</span>
                {" "}composite EV
              </p>
            </div>
            <div className="px-4 pb-4 grid grid-cols-2 gap-3">
              {state.data.districts.map((d) => (
                <DistrictCard
                  key={d.id}
                  district={d}
                  pathByTileId={pathByTileId}
                  selectedTileId={selectedTile?.id ?? null}
                  onTileSelect={setSelectedTile}
                />
              ))}
            </div>
          </section>
          <aside
            aria-label="Selected tile and agent path"
            className="w-[360px] shrink-0 bg-bg-panel border-l border-border-hairline flex flex-col gap-3 p-4 overflow-y-auto"
          >
            <SelectedTileCard tile={selectedTile} />
            <AgentPathList
              steps={state.data.agentPath}
              tilesById={tilesById}
              onStepClick={setSelectedTile}
            />
            <HeatMapLegend />
          </aside>
        </>
      ) : state.status === "loading" ? (
        <div
          role="status"
          aria-live="polite"
          className="flex-1 flex items-center justify-center text-text-secondary text-sm font-mono"
        >
          Loading heat-map…
        </div>
      ) : (
        <div
          role="alert"
          className="flex-1 flex flex-col items-center justify-center gap-2 text-status-danger text-sm font-mono"
        >
          <div>Could not load heat-map.</div>
          <div className="text-text-tertiary text-xs">{state.error}</div>
        </div>
      )}
    </AppShell>
  );
}
