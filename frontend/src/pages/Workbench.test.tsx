import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AsyncState } from "../api/routes";
import type { RunRow, StepRow } from "../api/tables";
import { RunsSheet, StepsSheet } from "./Workbench";

const RUN: RunRow = {
  run_id: "run-1",
  task_id: "task-1",
  model: "model-1",
  outcome: "pass",
  outcome_source: "external",
  total_tokens: 10,
  total_cost_usd: 0.01,
  latency_s: 1,
  event_count: 1,
  tool_call_count: 1,
  unique_targets: 1,
  error_count: 0,
  cluster_id: 0,
  distance_to_centroid: 0,
  is_representative: true,
  cost_usd_z: 0,
  tokens_total_z: 0,
  latency_s_z: 0,
  event_count_z: 0,
};

const STEP: StepRow = {
  run_id: "run-1",
  seq_idx: 0,
  event_type: "file_read",
  target: "src/main.ts",
  tokens: 10,
  time_seconds: 0.1,
};

function ready<T>(data: T): AsyncState<T> {
  return { status: "ready", data, retry: vi.fn() };
}

describe("Workbench dependency states", () => {
  it("surfaces a route-data failure on the runs sheet", () => {
    const html = renderToStaticMarkup(
      <RunsSheet
        state={ready([RUN])}
        routeState={{
          status: "error",
          error: "route request failed",
          retry: vi.fn(),
        }}
        rows={[RUN]}
        grouping={[]}
        selection={{}}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(html).toContain("Unable to load route data");
    expect(html).toContain("route request failed");
    expect(html).toContain(">Retry</button>");
    expect(html).not.toContain("Preparing runs");
  });

  it("surfaces a run-scope failure on the steps sheet", () => {
    const html = renderToStaticMarkup(
      <StepsSheet
        state={ready([STEP])}
        scopeDependency={{
          status: "error",
          error: "runs request failed",
          retry: vi.fn(),
        }}
        scopeIds="loading"
        localFilter={() => true}
      />,
    );

    expect(html).toContain("Unable to load run scope");
    expect(html).toContain("runs request failed");
    expect(html).toContain(">Retry</button>");
    expect(html).not.toContain("Resolving run scope");
  });
});
