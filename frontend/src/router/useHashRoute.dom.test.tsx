// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useHashRoute } from "./useHashRoute";

function RouterHarness() {
  const [view, params, navigate] = useHashRoute();
  return (
    <div>
      <output aria-label="route-state">
        {JSON.stringify({ view, ...params })}
      </output>
      <button type="button" onClick={() => navigate("steps")}>
        steps
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("hash router mounted history contract", () => {
  it("keeps experiment/scope, drops local filters, and follows back/forward", async () => {
    window.history.replaceState(
      null,
      "",
      "/#/runs?experiment=exp-a&f=outcome:eq:pass&s=model:eq:m1&runs=run-a",
    );
    render(<RouterHarness />);

    fireEvent.click(screen.getByRole("button", { name: "steps" }));
    await waitFor(() => expect(window.location.hash).toContain("#/steps?"));
    expect(window.location.hash).toContain("experiment=exp-a");
    expect(window.location.hash).toContain("s=model:eq:m1");
    expect(window.location.hash).toContain("runs=run-a");
    expect(window.location.hash).not.toContain("f=");

    window.location.hash = "#/edges?experiment=exp-b&s=outcome:eq:fail";
    await waitFor(() =>
      expect(screen.getByLabelText("route-state").textContent).toContain(
        '"experiment":"exp-b"',
      ),
    );

    window.history.back();
    await waitFor(() =>
      expect(screen.getByLabelText("route-state").textContent).toContain(
        '"experiment":"exp-a"',
      ),
    );

    window.history.forward();
    await waitFor(() =>
      expect(screen.getByLabelText("route-state").textContent).toContain(
        '"experiment":"exp-b"',
      ),
    );
  });
});
