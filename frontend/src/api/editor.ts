import { useEffect, useState } from "react";

export type StageKind = "plan" | "retrieve" | "edit" | "test" | "repair";

/**
 * Node data shape. The `[k: string]: unknown` index signature satisfies
 * ReactFlow's `Record<string, unknown>` data constraint without
 * weakening the named fields.
 */
export interface EditorNodeData {
  label: string;
  kind: StageKind;
  model: string;
  detail: string | null;
  [k: string]: unknown;
}

export interface EditorNode {
  id: string;
  type: "stage";
  position: { x: number; y: number };
  data: EditorNodeData;
}

export interface EditorEdge {
  id: string;
  source: string;
  target: string;
  label: string | null;
}

export interface EditorResponse {
  harnessId: string;
  harnessName: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
  yaml: string;
}

export type EditorState =
  | { status: "loading" }
  | { status: "ready"; data: EditorResponse }
  | { status: "error"; error: string };

export function useEditor(): EditorState {
  const [state, setState] = useState<EditorState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/editor", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return (await res.json()) as EditorResponse;
      })
      .then((data) => setState({ status: "ready", data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => controller.abort();
  }, []);
  return state;
}
