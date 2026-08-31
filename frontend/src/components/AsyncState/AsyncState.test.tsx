import { Children, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AsyncState } from "../../api/routes";
import { AsyncCollection, StateNotice } from "./AsyncState";

interface ClickableProps {
  children?: ReactNode;
  onClick?: () => void;
}

function findButton(node: ReactNode): ReactElement<ClickableProps> | null {
  if (!isValidElement<ClickableProps>(node)) return null;
  if (node.type === "button") return node;
  for (const child of Children.toArray(node.props.children)) {
    const button = findButton(child);
    if (button) return button;
  }
  return null;
}

function renderCollection(state: AsyncState<string[]>): string {
  return renderToStaticMarkup(
    <AsyncCollection
      state={state}
      label="experiments"
      emptyTitle="No experiments found"
      emptyDetail="The API returned no experiments."
    >
      {(items) => <p>ready: {items.join(", ")}</p>}
    </AsyncCollection>,
  );
}

describe("AsyncCollection", () => {
  it("renders an announced loading state", () => {
    const html = renderCollection({ status: "loading", retry: vi.fn() });

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading experiments…");
  });

  it("renders an actionable error with the API diagnostic", () => {
    const html = renderCollection({
      status: "error",
      error: "503 Service Unavailable",
      retry: vi.fn(),
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain("Unable to load experiments");
    expect(html).toContain("503 Service Unavailable");
    expect(html).toContain(">Retry</button>");
    expect(html).toContain("text-text-secondary");
    expect(html).not.toContain("text-text-tertiary");
  });

  it("distinguishes an empty API response from loading", () => {
    const html = renderCollection({ status: "ready", data: [], retry: vi.fn() });

    expect(html).toContain("No experiments found");
    expect(html).toContain("The API returned no experiments.");
    expect(html).toContain(">Refresh</button>");
    expect(html).not.toContain("Loading experiments");
  });

  it("renders content only after non-empty data is ready", () => {
    const html = renderCollection({
      status: "ready",
      data: ["experiment-a"],
      retry: vi.fn(),
    });

    expect(html).toContain("ready: experiment-a");
    expect(html).not.toContain('role="status"');
  });
});

describe("StateNotice recovery action", () => {
  it("calls the supplied retry handler", () => {
    const retry = vi.fn();
    const notice = StateNotice({
      tone: "error",
      title: "Unable to load runs",
      actionLabel: "Retry",
      onAction: retry,
    });

    const button = findButton(notice);
    expect(button).not.toBeNull();
    button!.props.onClick?.();
    expect(retry).toHaveBeenCalledOnce();
  });
});
