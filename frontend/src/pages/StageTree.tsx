import { useMemo, useState } from "react";
import clsx from "clsx";
import { AppShell } from "./AppShell";
import { Button } from "../components/Button";
import { LeftPane, type LeftPaneSection } from "../components/composites/LeftPane";
import { EVDecompositionTable } from "../components/EVDecompositionTable";
import type { BottomBarEntry } from "../components/composites/BottomBar";
import {
  useStageTree,
  type DownstreamProjection,
  type StageCandidate,
  type StageNode,
  type StageStatus,
  type StageTreeResponse,
} from "../api/stagetree";

/**
 * Stage-tree page — 5-stage agent pipeline + per-stage action space.
 *
 * Bit-locked to Figma page 06 Stage-tree (node 78:2). Center pane
 * shows the linear stage flow (Plan → Retrieve → Edit → Test →
 * Repair) with the currently-selected node expanded into a 4-card
 * candidate grid. Right pane breaks the selected node's EV into 8
 * signal contributions + a downstream-impact projection for the
 * 3 alternates.
 *
 * Selection: clicking any stage flips selectedStage; the candidate
 * grid and decomposition tables re-key off the active node.
 */

const STATUS_GLYPH: Record<StageStatus, string> = {
  complete: "✓",
  current: "▶",
  pending: "◌",
};

const STATUS_TONE: Record<StageStatus, string> = {
  complete: "text-status-success",
  current: "text-accent-primary",
  pending: "text-text-tertiary",
};

function StageCard({
  node,
  active,
  onSelect,
}: {
  node: StageNode;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      data-stage={node.id}
      data-status={node.status}
      className={clsx(
        "w-28 h-[86px] rounded-md p-3 flex flex-col items-start gap-1",
        "bg-bg-panel border transition-colors",
        active
          ? "border-accent-primary ring-1 ring-accent-primary"
          : "border-border-hairline hover:border-border-strong",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-primary",
        "text-left",
      )}
    >
      <div className="flex items-center gap-1.5 text-sm font-sans font-medium text-text-primary">
        <span aria-hidden="true" className={clsx("leading-none", STATUS_TONE[node.status])}>
          {STATUS_GLYPH[node.status]}
        </span>
        <span>{node.name}</span>
      </div>
      <div className="text-text-tertiary text-xs font-mono truncate w-full">
        {node.chosenModel}
      </div>
      <div
        className={clsx(
          "font-mono text-xl font-medium tabular-nums leading-none mt-0.5",
          node.ev.startsWith("−")
            ? "text-heat-pollution-500"
            : node.ev === "+0.00"
              ? "text-text-secondary"
              : "text-heat-productivity-500",
        )}
      >
        {node.ev}
      </div>
    </button>
  );
}

function StageFlow({
  stages,
  selected,
  onSelect,
}: {
  stages: StageNode[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex items-center flex-wrap gap-2" data-canon="stageflow-79:66">
      {stages.map((node, i) => (
        <div key={node.id} className="flex items-center gap-2">
          <StageCard
            node={node}
            active={node.id === selected}
            onSelect={() => onSelect(node.id)}
          />
          {i < stages.length - 1 ? (
            <span aria-hidden="true" className="text-text-tertiary text-md">
              →
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CandidateCard({ candidate }: { candidate: StageCandidate }) {
  return (
    <article
      className={clsx(
        "rounded-md p-3.5 flex flex-col gap-2 min-w-0",
        "bg-bg-panel border",
        candidate.isChosen
          ? "border-status-warning ring-2 ring-inset ring-status-warning/40"
          : "border-border-hairline",
      )}
      data-model={candidate.model}
      data-chosen={candidate.isChosen ? "true" : "false"}
    >
      <header className="flex items-center justify-between gap-2">
        <span className="font-sans text-sm font-medium text-text-primary truncate">
          {candidate.model}
        </span>
        {candidate.isChosen ? (
          <span className="font-mono text-2xs uppercase tracking-wide bg-status-warning text-bg-canvas px-1.5 py-0.5 rounded-sm">
            Chosen
          </span>
        ) : null}
      </header>
      <div
        className={clsx(
          "font-mono text-2xl font-medium tabular-nums leading-tight",
          candidate.ev.startsWith("−")
            ? "text-heat-pollution-500"
            : candidate.ev === "+0.00"
              ? "text-text-secondary"
              : "text-heat-productivity-500",
        )}
      >
        {candidate.ev}
      </div>
      <div className="text-text-tertiary text-2xs font-mono">
        {candidate.evCaption}
      </div>
      <div className="border-t border-border-hairline pt-2 flex flex-col gap-1.5 text-2xs">
        <div className="flex justify-between text-text-secondary">
          <span className="font-sans">pass</span>
          <span className="font-mono text-text-primary tabular-nums">
            {candidate.passes} / {candidate.total} · {candidate.passRate}
          </span>
        </div>
        <div className="flex justify-between text-text-secondary">
          <span className="font-sans">cost</span>
          <span className="font-mono text-text-primary tabular-nums">
            {candidate.costPerRun}
          </span>
        </div>
        <div className="flex justify-between text-text-secondary">
          <span className="font-sans">latency</span>
          <span className="font-mono text-text-primary tabular-nums">
            {candidate.latencyP50}
          </span>
        </div>
      </div>
    </article>
  );
}

function DownstreamTable({ rows }: { rows: DownstreamProjection[] }) {
  return (
    <section
      aria-label="Downstream impact projection"
      role="table"
      className="rounded-md bg-bg-panel border border-border-hairline overflow-hidden"
    >
      <div role="rowgroup">
        <div
          role="row"
          className="grid grid-cols-[1fr_64px_64px_88px] gap-2 px-3.5 py-2.5 bg-bg-sunken text-text-secondary text-2xs uppercase tracking-wide font-medium"
        >
          <span role="columnheader" className="font-sans">if locked</span>
          <span role="columnheader" className="font-mono text-right">Test Δ</span>
          <span role="columnheader" className="font-mono text-right">Repair Δ</span>
          <span role="columnheader" className="font-mono text-right">Composite Δ</span>
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((r, i) => (
          <div
            key={r.model}
            role="row"
            className={clsx(
              "grid grid-cols-[1fr_64px_64px_88px] gap-2 px-3.5 py-2 text-sm",
              i % 2 === 0 ? "bg-bg-elevated" : "bg-bg-panel",
            )}
          >
            <span role="cell" className="font-sans text-text-primary truncate">
              {r.model}
            </span>
            <span
              role="cell"
              className={clsx(
                "font-mono text-right tabular-nums",
                r.testDelta.startsWith("−")
                  ? "text-heat-pollution-500"
                  : r.testDelta === "+0.00"
                    ? "text-text-secondary"
                    : "text-heat-productivity-500",
              )}
            >
              {r.testDelta}
            </span>
            <span
              role="cell"
              className={clsx(
                "font-mono text-right tabular-nums",
                r.repairDelta.startsWith("−")
                  ? "text-heat-pollution-500"
                  : r.repairDelta === "+0.00"
                    ? "text-text-secondary"
                    : "text-heat-productivity-500",
              )}
            >
              {r.repairDelta}
            </span>
            <span
              role="cell"
              className={clsx(
                "font-mono text-right font-medium tabular-nums",
                r.compositeDelta.startsWith("−")
                  ? "text-status-danger"
                  : "text-status-success",
              )}
            >
              {r.compositeDelta}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CenterPane({
  data,
  selected,
  onSelect,
}: {
  data: StageTreeResponse;
  selected: StageNode;
  onSelect: (id: string) => void;
}) {
  return (
    <section
      className="flex-1 min-w-0 bg-bg-canvas flex flex-col overflow-auto"
      data-canon="centerpane-78:100"
    >
      <div className="px-4 pt-4 pb-3">
        <h2 className="font-sans text-lg font-medium text-text-primary">
          Stage-tree · agent pipeline
        </h2>
        <p className="text-text-secondary text-sm">
          {data.stages.length} decision nodes · {data.harness} · iter 47/50 ·{" "}
          <span className="text-text-primary">
            click any node to inspect its action space
          </span>
        </p>
      </div>
      <div className="px-4 pb-4 flex flex-col gap-5">
        <StageFlow stages={data.stages} selected={selected.id} onSelect={onSelect} />
        <div>
          <div className="flex items-baseline justify-between pb-2">
            <h3 className="font-sans text-sm font-medium uppercase tracking-wide text-text-primary">
              {selected.name} · model candidates
            </h3>
            <span className="text-text-tertiary text-xs font-mono">
              {data.candidates.length} candidates · 50 sim runs each · what-if EV vs chosen{" "}
              <span className="text-text-primary">{selected.chosenModel}</span>
            </span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {data.candidates.map((c) => (
              <CandidateCard key={c.model} candidate={c} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SelectedNodeBanner({
  selected,
  description,
}: {
  selected: StageNode & { position: number };
  description: string;
}) {
  return (
    <section
      aria-label="Selected node"
      className="rounded-md bg-bg-panel border border-accent-primary/40 p-3 flex flex-col gap-1"
    >
      <div className="flex items-center gap-2 text-2xs font-mono uppercase tracking-wide text-text-tertiary">
        <span aria-hidden="true" className="text-accent-primary">▶</span>
        Selected node · stage {selected.position} of 5
      </div>
      <h3 className="font-sans text-xl font-semibold text-text-primary">
        {selected.name}
      </h3>
      <p className="text-text-secondary text-sm leading-snug">{description}</p>
      <div className="border-t border-border-hairline pt-2 mt-1 flex items-center justify-between text-xs">
        <span className="font-sans text-text-tertiary uppercase tracking-wide">
          Current choice
        </span>
        <span className="font-mono text-text-primary tabular-nums">
          {selected.chosenModel} · {selected.ev} EV
        </span>
      </div>
    </section>
  );
}

function RightPane({
  selected,
  description,
  evDecomposition,
  downstreamProjections,
  projectionSummary,
}: {
  selected: StageNode & { position: number };
  description: string;
  evDecomposition: StageTreeResponse["evDecomposition"];
  downstreamProjections: DownstreamProjection[];
  projectionSummary: string;
}) {
  return (
    <aside
      aria-label="Selected node detail"
      className="w-[360px] shrink-0 bg-bg-panel border-l border-border-hairline flex flex-col gap-3 p-4 overflow-y-auto"
      data-canon="rightpane-78:275"
    >
      <SelectedNodeBanner selected={selected} description={description} />
      <EVDecompositionTable
        rows={evDecomposition.rows}
        harness={`${selected.name} node total`}
        composite={evDecomposition.total}
        compositeTone={evDecomposition.total.startsWith("−") ? "danger" : "success"}
      />
      <section aria-label="Downstream projection" className="flex flex-col gap-2">
        <header>
          <h3 className="font-sans text-sm font-medium uppercase tracking-wide text-text-primary">
            Downstream-impact projection
          </h3>
          <p className="text-text-tertiary text-2xs">
            if you lock a different model here, here's what changes — v0.4 simulation preview
          </p>
        </header>
        <DownstreamTable rows={downstreamProjections} />
      </section>
      <p className="text-text-secondary text-xs leading-snug">{projectionSummary}</p>
      <div className="flex gap-2 mt-auto pt-1">
        <Button kind="primary">Lock {selected.chosenModel}</Button>
        <Button kind="secondary">Re-solve</Button>
      </div>
    </aside>
  );
}

function buildLeftPaneSections(
  data: StageTreeResponse,
  selectedStage: string,
): LeftPaneSection[] {
  return [
    {
      title: "Stages",
      rows: data.stages.map((s) => ({
        label: s.name,
        value: s.ev,
        selected: s.id === selectedStage,
      })),
    },
  ];
}

function buildBottomBarEntries(
  data: StageTreeResponse | null,
  selected: StageNode | null,
): { left: BottomBarEntry[]; right: BottomBarEntry[] } {
  return {
    left: [
      {
        tone: "info",
        label: "stages",
        detail: data ? `${data.stages.length} · ${selected?.name ?? "—"} selected` : "—",
      },
      {
        tone: "success",
        label: data ? `Top: ${data.harness}` : "—",
        detail: selected ? `${selected.ev} at ${selected.name.toLowerCase()}` : "",
      },
    ],
    right: [
      { tone: "success", label: "workers 8/8", detail: "p50 1.4s · p95 5.2s" },
      { tone: "success", label: "v0.3-alpha", detail: "14:22" },
    ],
  };
}

export function StageTree() {
  const state = useStageTree();
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);

  const effectiveStageId =
    selectedStageId ?? (state.status === "ready" ? state.data.selectedStage : null);

  const selected = useMemo<(StageNode & { position: number }) | null>(() => {
    if (state.status !== "ready" || !effectiveStageId) return null;
    const idx = state.data.stages.findIndex((s) => s.id === effectiveStageId);
    if (idx === -1) return null;
    const node = state.data.stages[idx];
    if (!node) return null;
    return { ...node, position: idx + 1 };
  }, [state, effectiveStageId]);

  const bottomEntries = buildBottomBarEntries(
    state.status === "ready" ? state.data : null,
    selected,
  );

  return (
    <AppShell
      crumb="/ 06 Stage-tree"
      pageTitle="RunoGraph Stage-tree"
      weightProfile="balanced"
      bottomLeft={bottomEntries.left}
      bottomRight={bottomEntries.right}
    >
      {state.status === "ready" && selected ? (
        <>
          <LeftPane
            sections={buildLeftPaneSections(state.data, effectiveStageId ?? "")}
            onRowClick={(_, label) => {
              const match = state.data.stages.find((s) => s.name === label);
              if (match) setSelectedStageId(match.id);
            }}
          />
          <CenterPane
            data={state.data}
            selected={selected}
            onSelect={setSelectedStageId}
          />
          <RightPane
            selected={selected}
            description={state.data.selectedStageDescription}
            evDecomposition={state.data.evDecomposition}
            downstreamProjections={state.data.downstreamProjections}
            projectionSummary={state.data.projectionSummary}
          />
        </>
      ) : state.status === "loading" ? (
        <div
          role="status"
          aria-live="polite"
          className="flex-1 flex items-center justify-center text-text-secondary text-sm font-mono"
        >
          Loading stage-tree…
        </div>
      ) : (
        <div
          role="alert"
          className="flex-1 flex flex-col items-center justify-center gap-2 text-status-danger text-sm font-mono"
        >
          <div>Could not load stage-tree.</div>
          <div className="text-text-tertiary text-xs">
            {state.status === "error" ? state.error : ""}
          </div>
        </div>
      )}
    </AppShell>
  );
}
