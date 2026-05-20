import { useEffect, useState } from "react";

export type StageStatus = "complete" | "current" | "pending";

export interface StageNode {
  id: string;
  name: string;
  status: StageStatus;
  chosenModel: string;
  ev: string;
}

export interface StageCandidate {
  model: string;
  isChosen: boolean;
  ev: string;
  evCaption: string;
  passes: number;
  total: number;
  passRate: string;
  costPerRun: string;
  latencyP50: string;
}

export interface StageEVDecompRow {
  signal: string;
  weight: string;
  contribution: string;
  tone: "success" | "danger";
}

export interface StageEVDecomp {
  rows: StageEVDecompRow[];
  total: string;
}

export interface DownstreamProjection {
  model: string;
  testDelta: string;
  repairDelta: string;
  compositeDelta: string;
}

export interface StageTreeResponse {
  harness: string;
  stages: StageNode[];
  selectedStage: string;
  selectedStageDescription: string;
  candidates: StageCandidate[];
  evDecomposition: StageEVDecomp;
  downstreamProjections: DownstreamProjection[];
  projectionSummary: string;
}

export type StageTreeState =
  | { status: "loading" }
  | { status: "ready"; data: StageTreeResponse }
  | { status: "error"; error: string };

export function useStageTree(): StageTreeState {
  const [state, setState] = useState<StageTreeState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/stagetree", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return (await res.json()) as StageTreeResponse;
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
