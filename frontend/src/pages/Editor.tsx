import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AppShell } from "./AppShell";
import { LeftPane, type LeftPaneSection } from "../components/composites/LeftPane";
import type { BottomBarEntry } from "../components/composites/BottomBar";
import {
  useEditor,
  type EditorNodeData,
  type EditorResponse,
  type StageKind,
} from "../api/editor";

/**
 * Editor page — visual harness pipeline composer.
 *
 * Backed by ReactFlow / @xyflow/react. v0.3 alpha ships read-only:
 * nodes are not draggable, edges are not connectable, the canvas
 * pans + zooms via the built-in Controls. v0.4 unlocks editing per
 * the canon 06 Node editor v2 page.
 *
 * Center pane = canvas with 5 stage nodes (plan → retrieve → edit
 * → test → repair) and 4 edges. Right pane = YAML preview pulled
 * from the backend (the canon Harness B configuration).
 */

const KIND_TONE: Record<StageKind, { fg: string; bg: string; border: string }> = {
  plan: {
    fg: "text-text-primary",
    bg: "bg-bg-panel",
    border: "border-status-info",
  },
  retrieve: {
    fg: "text-text-primary",
    bg: "bg-bg-panel",
    border: "border-accent-primary",
  },
  edit: {
    fg: "text-text-primary",
    bg: "bg-bg-panel",
    border: "border-status-warning",
  },
  test: {
    fg: "text-text-primary",
    bg: "bg-bg-panel",
    border: "border-status-success",
  },
  repair: {
    fg: "text-text-primary",
    bg: "bg-bg-panel",
    border: "border-status-danger",
  },
};

function StageNodeView({ data }: NodeProps<Node<EditorNodeData>>) {
  const tone = KIND_TONE[data.kind];
  return (
    <article
      className={clsx(
        "w-[200px] rounded-md border-2 px-3 py-2 flex flex-col gap-1",
        tone.bg,
        tone.border,
        tone.fg,
      )}
      data-kind={data.kind}
    >
      {/* Source / target handles — required for ReactFlow to draw the
          connecting edges. !opacity-0 keeps them invisible while still
          connectable; the !-prefix overrides the default xyflow class. */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-border-strong !border-bg-canvas"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-border-strong !border-bg-canvas"
      />
      <header className="flex items-center justify-between">
        <span className="font-sans text-sm font-medium">{data.label}</span>
        <span className="font-mono text-2xs uppercase tracking-wide text-text-tertiary">
          {data.kind}
        </span>
      </header>
      <div className="font-mono text-xs text-text-primary truncate">{data.model}</div>
      {data.detail ? (
        <div className="font-mono text-2xs text-text-secondary truncate">
          {data.detail}
        </div>
      ) : null}
    </article>
  );
}

const NODE_TYPES = { stage: StageNodeView } as const;

function buildLeftPaneSections(data: EditorResponse): LeftPaneSection[] {
  return [
    {
      title: "Pipeline",
      rows: data.nodes.map((n) => ({
        label: n.data.label,
        value: n.data.model,
      })),
    },
    {
      title: "Palette",
      rows: ["plan", "retrieve", "edit", "test", "repair"].map((k) => ({
        label: k,
      })),
    },
  ];
}

function buildBottomBarEntries(
  data: EditorResponse | null,
): { left: BottomBarEntry[]; right: BottomBarEntry[] } {
  return {
    left: [
      {
        tone: "info",
        label: "harness",
        detail: data ? `${data.harnessId} · ${data.nodes.length} nodes` : "—",
      },
      {
        tone: "warning",
        label: "view-only",
        detail: "editing unlocks in v0.4",
      },
    ],
    right: [
      { tone: "success", label: "workers 8/8", detail: "p50 1.4s · p95 5.2s" },
      { tone: "success", label: "v0.3-alpha", detail: "14:22" },
    ],
  };
}

function YAMLPreview({ yaml, harnessName }: { yaml: string; harnessName: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable in the iframe sandbox — silently skip */
    }
  };
  return (
    <section
      aria-label="Harness YAML preview"
      className="rounded-md bg-bg-sunken border border-border-hairline flex flex-col flex-1 min-h-0 overflow-hidden"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-border-hairline bg-bg-panel">
        <div className="flex flex-col">
          <span className="font-sans text-sm font-medium text-text-primary">
            harness.yaml
          </span>
          <span className="font-mono text-2xs text-text-tertiary">
            {harnessName}
          </span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className={clsx(
            "h-7 px-2 rounded-sm text-2xs font-medium uppercase tracking-wide",
            "border transition-colors",
            copied
              ? "border-status-success text-status-success"
              : "border-border-hairline text-text-secondary hover:text-text-primary hover:bg-bg-elevated",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-primary",
          )}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </header>
      <pre className="m-0 p-3 overflow-auto flex-1 font-mono text-xs text-text-secondary leading-relaxed">
        {yaml}
      </pre>
    </section>
  );
}

export function Editor() {
  const state = useEditor();

  const nodes: Node<EditorNodeData>[] = useMemo(() => {
    if (state.status !== "ready") return [];
    return state.data.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    }));
  }, [state]);

  const edges: Edge[] = useMemo(() => {
    if (state.status !== "ready") return [];
    return state.data.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label ?? undefined,
      animated: true,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--rg-text-tertiary, #6b7280)" },
      style: { stroke: "rgb(var(--rg-border-strong))", strokeWidth: 1.5 },
      labelStyle: { fill: "rgb(var(--rg-text-tertiary))", fontSize: 11 },
      labelBgStyle: { fill: "rgb(var(--rg-bg-panel))" },
    }));
  }, [state]);

  const bottomEntries = buildBottomBarEntries(
    state.status === "ready" ? state.data : null,
  );

  return (
    <AppShell
      crumb="/ 07 Editor"
      pageTitle="RunoGraph Editor"
      weightProfile="balanced"
      bottomLeft={bottomEntries.left}
      bottomRight={bottomEntries.right}
    >
      {state.status === "ready" ? (
        <>
          <LeftPane sections={buildLeftPaneSections(state.data)} />
          <section
            className="flex-1 min-w-0 bg-bg-canvas flex flex-col"
            data-canon="editor-canvas-83:2"
          >
            <div className="px-4 pt-4 pb-3 flex items-baseline justify-between">
              <div>
                <h2 className="font-sans text-lg font-medium text-text-primary">
                  Harness editor · {state.data.harnessName}
                </h2>
                <p className="text-text-secondary text-sm">
                  5-stage DAG · pan + zoom in this build ·{" "}
                  <span className="text-status-warning">view-only in v0.3</span>
                </p>
              </div>
            </div>
            <div className="flex-1 min-h-0 mx-4 mb-4 rounded-md border border-border-hairline overflow-hidden bg-bg-canvas">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                proOptions={{ hideAttribution: true }}
                colorMode="dark"
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={16}
                  size={1}
                  color="rgb(var(--rg-border-hairline))"
                />
                <Controls
                  showInteractive={false}
                  className="!bg-bg-panel !border-border-hairline !text-text-secondary"
                />
              </ReactFlow>
            </div>
          </section>
          <aside
            aria-label="YAML preview"
            className="w-[400px] shrink-0 bg-bg-panel border-l border-border-hairline flex flex-col gap-3 p-4 overflow-hidden"
          >
            <YAMLPreview yaml={state.data.yaml} harnessName={state.data.harnessName} />
          </aside>
        </>
      ) : state.status === "loading" ? (
        <div
          role="status"
          aria-live="polite"
          className="flex-1 flex items-center justify-center text-text-secondary text-sm font-mono"
        >
          Loading editor…
        </div>
      ) : (
        <div
          role="alert"
          className="flex-1 flex flex-col items-center justify-center gap-2 text-status-danger text-sm font-mono"
        >
          <div>Could not load editor.</div>
          <div className="text-text-tertiary text-xs">
            {state.status === "error" ? state.error : ""}
          </div>
        </div>
      )}
    </AppShell>
  );
}
