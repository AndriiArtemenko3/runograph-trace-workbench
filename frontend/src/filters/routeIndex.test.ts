/**
 * Twin of the route.* cases in backend/tests/test_run_filter.py — same
 * fabricated two-run route data, same expected match sets.
 */

import { describe, expect, it } from "vitest";

import type { StepRow } from "../api/tables";
import { parsePredicate } from "./predicate";
import { buildRouteIndex, routePredicateMatches } from "./routeIndex";

function step(run_id: string, seq_idx: number, event_type: string, target: string): StepRow {
  return { run_id, seq_idx, event_type, target, tokens: 10, time_seconds: 0.1 };
}

const STEPS: StepRow[] = [
  step("r-a", 0, "file_read", "a.py"),
  step("r-a", 1, "file_edit", "b.py"),
  step("r-b", 0, "file_read", "a.py"),
  step("r-b", 1, "error", "c.py"),
];

const CASES: [string, string[]][] = [
  ["route.target:contains:A.PY", ["r-a", "r-b"]],
  ["route.target:eq:b.py", ["r-a"]],
  ["route.event_type:in:error", ["r-b"]],
  ["route.edge:eq:a.py>b.py", ["r-a"]],
  ["route.edge:eq:b.py>a.py", []],
];

describe("routeIndex", () => {
  const idx = buildRouteIndex(STEPS);
  it.each(CASES)("%s matches %o", (raw, expected) => {
    const p = parsePredicate(raw);
    const matched = ["r-a", "r-b"].filter((rid) =>
      routePredicateMatches(idx, rid, p),
    );
    expect(matched).toEqual(expected);
  });
});
