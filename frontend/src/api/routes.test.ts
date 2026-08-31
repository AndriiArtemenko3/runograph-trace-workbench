import { describe, expect, it, vi } from "vitest";

import { createRequestRunner, stateForUrl } from "./routes";
import type { AsyncDataState } from "./routes";

describe("createRequestRunner", () => {
  it("recovers from an API failure when the request is retried", async () => {
    const states: AsyncDataState<string>[] = [];
    let attempts = 0;
    const fetcher = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("Failed to fetch");
      return "recovered";
    });
    const runner = createRequestRunner("/api/v1/experiments", (state) => {
      states.push(state);
    }, fetcher);

    await runner.run();
    await runner.run();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(states).toEqual([
      { status: "loading" },
      { status: "error", error: "Failed to fetch" },
      { status: "loading" },
      { status: "ready", data: "recovered" },
    ]);
  });

  it("aborts and ignores a stale attempt when retry starts", async () => {
    const states: AsyncDataState<string>[] = [];
    const signals: AbortSignal[] = [];
    let resolveFirst: (value: string) => void = () => undefined;
    const firstResponse = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    let attempts = 0;
    const fetcher = vi.fn((_url: string, signal: AbortSignal) => {
      signals.push(signal);
      attempts += 1;
      return attempts === 1 ? firstResponse : Promise.resolve("fresh");
    });
    const runner = createRequestRunner("/api/v1/tables/runs", (state) => {
      states.push(state);
    }, fetcher);

    const firstRun = runner.run();
    await runner.run();
    resolveFirst("stale");
    await firstRun;

    expect(signals).toHaveLength(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    expect(states).toEqual([
      { status: "loading" },
      { status: "loading" },
      { status: "ready", data: "fresh" },
    ]);
  });

  it("publishes nothing after lifecycle cancellation", async () => {
    const states: AsyncDataState<string>[] = [];
    let resolveResponse: (value: string) => void = () => undefined;
    const response = new Promise<string>((resolve) => {
      resolveResponse = resolve;
    });
    let requestSignal: AbortSignal | null = null;
    const runner = createRequestRunner<string>(
      "/api/v1/experiments",
      (state) => states.push(state),
      (_url, signal) => {
        requestSignal = signal;
        return response;
      },
    );

    const request = runner.run();
    runner.cancel();
    resolveResponse("late data");
    await request;

    expect(requestSignal).not.toBeNull();
    expect(requestSignal!.aborted).toBe(true);
    expect(states).toEqual([{ status: "loading" }]);
  });
});

describe("stateForUrl", () => {
  it("masks a previous URL's data while the next request starts", () => {
    const previous = {
      url: "/api/v1/tables/runs?experiment=old",
      state: { status: "ready" as const, data: ["old-run"] },
    };

    expect(
      stateForUrl(previous, "/api/v1/tables/runs?experiment=new"),
    ).toEqual({ status: "loading" });
    expect(stateForUrl(previous, previous.url)).toEqual(previous.state);
  });

  it("keeps disabled requests in loading without leaking a prior error", () => {
    const previous = {
      url: "/api/v1/tables/steps?experiment=old",
      state: { status: "error" as const, error: "old failure" },
    };

    expect(stateForUrl(previous, null)).toEqual({ status: "loading" });
  });
});
