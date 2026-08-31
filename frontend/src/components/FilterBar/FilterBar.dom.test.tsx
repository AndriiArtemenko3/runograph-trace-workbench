// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilterBar } from "./FilterBar";
import type { FilterColumn } from "./FilterBar";

const RUN_COLUMNS: FilterColumn[] = [
  { key: "run_id", kind: "string" },
  { key: "total_tokens", kind: "number" },
];
const STEP_COLUMNS: FilterColumn[] = [
  { key: "event_type", kind: "enum" },
  { key: "target", kind: "string" },
];

afterEach(cleanup);

describe("FilterBar sheet lifecycle", () => {
  it("resets stale builder column/operator when its keyed sheet changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterBar
        key="runs"
        columns={RUN_COLUMNS}
        predicates={[]}
        invalid={[]}
        onChange={onChange}
      />,
    );
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

    rerender(
      <FilterBar
        key="steps"
        columns={STEP_COLUMNS}
        predicates={[]}
        invalid={[]}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("Filter column")).toHaveProperty(
      "value",
      "event_type",
    );
    expect(screen.getByLabelText("Filter operator")).toHaveProperty("value", "eq");
  });
});
