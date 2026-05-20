import { useEffect, useState } from "react";
import type { HeatLevel } from "../components/HeatTile/HeatTile";

export interface HeatTileData {
  id: string;
  filename: string;
  productivity: HeatLevel;
  pollution: HeatLevel;
  reads: number;
  retrievals: number;
  evContribution: string;
}

export interface HeatDistrict {
  id: string;
  name: string;
  fileCount: number;
  evTotal: string;
  tiles: HeatTileData[];
}

export interface AgentPathStep {
  step: number;
  tileId: string;
  action: "read" | "retrieved" | "edited" | "test-failed";
}

export interface HeatMapResponse {
  districts: HeatDistrict[];
  agentPath: AgentPathStep[];
  compositeEv: string;
  harness: string;
  corpus: string;
}

export type HeatMapState =
  | { status: "loading" }
  | { status: "ready"; data: HeatMapResponse }
  | { status: "error"; error: string };

export function useHeatMap(): HeatMapState {
  const [state, setState] = useState<HeatMapState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/heatmap", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return (await res.json()) as HeatMapResponse;
      })
      .then((data) => setState({ status: "ready", data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: "error", error: message });
      });
    return () => controller.abort();
  }, []);
  return state;
}
