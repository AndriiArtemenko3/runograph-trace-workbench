// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClusterRow, EdgeRow, RunRow, StepRow } from "../api/tables";
import { Workbench } from "./Workbench";

const RUN_BASE: RunRow = {
  run_id: "run-a",
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
  cluster_id: 1,
  distance_to_centroid: 0,
  is_representative: true,
  cost_usd_z: 0,
  tokens_total_z: 0,
  latency_s_z: 0,
  event_count_z: 0,
};

const STEP_BASE: StepRow = {
  run_id: "run-a",
  seq_idx: 0,
  event_type: "file_read",
  target: "src/main.ts",
  tokens: 10,
  time_seconds: 0.1,
};

const CLUSTER: ClusterRow = {
  cluster_id: 1,
  n_runs: 1,
  representative_run_id: "run-a",
  outcome_label_source: "external",
  reported_pass_rate: 1,
  reported_error_rate: 0,
  cost_usd_mean: 0.01,
  cost_usd_median: 0.01,
  cost_usd_p95: 0.01,
  cost_usd_std: 0,
  tokens_total_mean: 10,
  tokens_total_median: 10,
  tokens_total_p95: 10,
  tokens_total_std: 0,
  latency_s_mean: 1,
  latency_s_median: 1,
  latency_s_p95: 1,
  latency_s_std: 0,
  event_count_mean: 1,
  event_count_median: 1,
  event_count_p95: 1,
  event_count_std: 0,
};

const EDGE: EdgeRow = {
  source: "src/a.ts",
  target: "src/b.ts",
  count: 1,
  outcome_label_source: "external",
  reported_pass_count: 1,
  reported_fail_count: 0,
  reported_error_count: 0,
  total_time_seconds: 0.1,
};

function installApi(runRows?: RunRow[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const parsed = new URL(url, window.location.origin);
    const experiment = parsed.searchParams.get("experiment") ?? "exp-a";
    const runId = experiment === "exp-b" ? "run-b" : "run-a";
    let body: unknown;
    if (parsed.pathname === "/api/v1/experiments") {
      body = [
        { experiment_id: "exp-a", run_count: 1 },
        { experiment_id: "exp-b", run_count: 1 },
      ];
    } else if (parsed.pathname === "/api/v1/tables/runs") {
      body = runRows ?? [{ ...RUN_BASE, run_id: runId }];
    } else if (parsed.pathname === "/api/v1/tables/steps") {
      body = [{ ...STEP_BASE, run_id: runId }];
    } else if (parsed.pathname === "/api/v1/tables/clusters") {
      body = [{ ...CLUSTER, representative_run_id: runId }];
    } else if (parsed.pathname === "/api/v1/tables/edges") {
      body = [EDGE];
    } else {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Workbench mounted URL lifecycle", () => {
  it("replaces bare-view canonicalization so it adds no history entry", async () => {
    installApi();
    window.history.replaceState(null, "", "/outside");
    window.history.pushState(null, "", "/");
    const historyLength = window.history.length;

    const mounted = render(<Workbench />);
    await waitFor(() =>
      expect(window.location.hash).toBe("#/runs?experiment=exp-a"),
    );
    expect(window.history.length).toBe(historyLength);

    mounted.unmount();
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/outside"));
  });

  it("reloads a shared experiment + scope hash without changing datasets", async () => {
    const fetchMock = installApi();
    window.history.replaceState(
      null,
      "",
      "/#/runs?experiment=exp-b&s=outcome:eq:pass&runs=run-b",
    );

    render(<Workbench />);

    await waitFor(() =>
      expect(screen.getByLabelText("Experiment")).toHaveProperty("value", "exp-b"),
    );
    expect(await screen.findByText("run-b")).toBeTruthy();
    expect(screen.getByText("outcome = pass ×")).toBeTruthy();
    expect(requestedUrls(fetchMock)).toContain(
      "/api/v1/tables/runs?experiment=exp-b",
    );
    expect(requestedUrls(fetchMock).some((url) => url.includes("experiment=exp-a"))).toBe(
      false,
    );
  });

  it("clears incompatible local and pinned scope when switching experiment", async () => {
    installApi();
    window.history.replaceState(
      null,
      "",
      "/#/runs?experiment=exp-b&f=outcome:eq:pass&s=model:eq:model-1&runs=run-b",
    );
    render(<Workbench />);
    await screen.findByText("run-b");

    fireEvent.change(screen.getByLabelText("Experiment"), {
      target: { value: "exp-a" },
    });

    await waitFor(() => expect(window.location.hash).toContain("experiment=exp-a"));
    expect(window.location.hash).not.toContain("&f=");
    expect(window.location.hash).not.toContain("&s=");
    expect(window.location.hash).not.toContain("runs=");
    expect(await screen.findByText("run-a")).toBeTruthy();
  });

  it("resets the mounted filter builder when navigating between sheets", async () => {
    installApi();
    window.history.replaceState(null, "", "/#/runs?experiment=exp-a");
    render(<Workbench />);
    await screen.findByText("run-a");

    fireEvent.change(screen.getByLabelText("Filter column"), {
      target: { value: "total_tokens" },
    });
    fireEvent.change(screen.getByLabelText("Filter operator"), {
      target: { value: "gte" },
    });
    expect(screen.getByLabelText("Filter column")).toHaveProperty(
      "value",
      "total_tokens",
    );
    expect(screen.getByLabelText("Filter operator")).toHaveProperty("value", "gte");

    fireEvent.click(screen.getByRole("button", { name: "steps" }));
    await waitFor(() => expect(window.location.hash).toContain("#/steps?"));
    await waitFor(() =>
      expect(screen.getByLabelText("Filter column")).toHaveProperty("value", "run_id"),
    );
    expect(screen.getByLabelText("Filter operator")).toHaveProperty("value", "eq");

    fireEvent.change(screen.getByLabelText("Filter column"), {
      target: { value: "event_type" },
    });
    fireEvent.change(screen.getByLabelText("Filter value"), {
      target: { value: "file_read" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ filter" }));
    expect(await screen.findByText("event_type = file_read ×")).toBeTruthy();
    expect(window.location.hash).toContain("f=event_type:eq:file_read");
  });

  it("does not reinterpret an unsafe legacy run ID as a URL scope", async () => {
    installApi(
      ["a,b", "a", "b"].map((runId) => ({ ...RUN_BASE, run_id: runId })),
    );
    window.history.replaceState(null, "", "/#/runs?experiment=exp-a");
    render(<Workbench />);

    const legacyCell = await screen.findByText("a,b");
    const legacyCheckbox = legacyCell
      .closest("tr")
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(legacyCheckbox).not.toBeNull();
    fireEvent.click(legacyCheckbox!);

    const scopeButton = screen.getByRole("button", {
      name: "scope to 1 selected",
    });
    expect(scopeButton).toHaveProperty("disabled", true);
    expect(
      screen.getByText(/Selected legacy run IDs cannot be URL-scoped/),
    ).toBeTruthy();
    fireEvent.click(scopeButton);
    expect(window.location.hash).not.toContain("runs=");
  });

});

describe("Workbench fail-closed URL contract", () => {
  it.each([
    "#/runs?experiment=exp-a&f=total_tokens:gte:abc",
    "#/runs?experiment=exp-a&f=unknown:eq:value",
    "#/runs?experiment=exp-a&s=outcome:gte:1",
    "#/runs?experiment=exp-a&runs=,,,%20",
    "#/runs?experiment=../escape",
    "#/runs?s=outcome:eq:pass&runs=run-b",
  ])("does not request trace tables for %s", async (hash) => {
    const fetchMock = installApi();
    window.history.replaceState(null, "", `/${hash}`);
    render(<Workbench />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Invalid workbench URL");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(requestedUrls(fetchMock).some((url) => url.includes("/tables/"))).toBe(
      false,
    );
  });

  it("uses AA-capable secondary text for provenance and diagnostics", async () => {
    installApi();
    window.history.replaceState(null, "", "/#/runs?experiment=exp-a");
    render(<Workbench />);
    const provenance = await screen.findByText(/Outcomes, token totals/);
    expect(provenance.className).toContain("text-text-secondary");
    expect(provenance.className).not.toContain("text-text-tertiary");
  });
});
