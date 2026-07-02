/**
 * Twin of backend/tests/test_run_filter.py — the golden vectors here must
 * stay identical to GOLDEN_PARSE / GOLDEN_REJECT / MATCH_TABLE there.
 * This is the guard against silent client/server evaluator drift.
 */

import { describe, expect, it } from "vitest";

import {
  compilePredicates,
  parsePredicate,
  percentile,
  predicateMatches,
  serializePredicate,
} from "./predicate";
import type { ColumnKind } from "./predicate";

const GOLDEN_PARSE: [string, string, string, string[]][] = [
  ["outcome:in:fail,error", "outcome", "in", ["fail", "error"]],
  ["total_cost_usd:gte:0.1", "total_cost_usd", "gte", ["0.1"]],
  ["cost_usd_z:absgte:2", "cost_usd_z", "absgte", ["2"]],
  ["target:contains:reporters", "target", "contains", ["reporters"]],
  ["total_tokens:between:1000,2000", "total_tokens", "between", ["1000", "2000"]],
  ["is_representative:eq:true", "is_representative", "eq", ["true"]],
  ["route.edge:eq:a.py>b.py", "route.edge", "eq", ["a.py>b.py"]],
];

const GOLDEN_REJECT = [
  "outcome",
  "outcome:in",
  "outcome:zz:x",
  "total_tokens:between:1",
  "total_cost_usd:gte:0.1,0.2",
  ":eq:1",
  "outcome:in:fail,",
];

const RUN_KINDS: Record<string, ColumnKind> = {
  run_id: "string",
  task_id: "string",
  model: "enum",
  outcome: "enum",
  total_tokens: "number",
  total_cost_usd: "number",
  latency_s: "number",
  event_count: "number",
  tool_call_count: "number",
  unique_targets: "number",
  error_count: "number",
  cluster_id: "enum",
  distance_to_centroid: "number",
  is_representative: "boolean",
  cost_usd_z: "number",
  tokens_total_z: "number",
  latency_s_z: "number",
  event_count_z: "number",
};

const BASE_ROW: Record<string, unknown> = {
  run_id: "sample-run-0001",
  task_id: "pylint-dev__pylint-7993",
  model: "claude-sonnet-4-6",
  outcome: "pass",
  total_tokens: 11842,
  total_cost_usd: 0.12,
  latency_s: 137.0,
  event_count: 10,
  tool_call_count: 3,
  unique_targets: 5,
  error_count: 0,
  cluster_id: 1,
  distance_to_centroid: 0.0,
  is_representative: true,
  cost_usd_z: 0.0,
  tokens_total_z: 0.0,
  latency_s_z: 0.0,
  event_count_z: 0.0,
};

const MATCH_TABLE: [Record<string, unknown>, string, boolean][] = [
  [{}, "outcome:eq:pass", true],
  [{}, "outcome:in:fail,error", false],
  [{}, "total_cost_usd:gte:0.1", true],
  [{}, "total_cost_usd:lt:0.1", false],
  [{}, "total_tokens:between:10000,12000", true],
  [{}, "run_id:contains:SAMPLE", true],
  [{}, "run_id:eq:SAMPLE-RUN-0001", false],
  [{}, "cluster_id:eq:1", true],
  [{}, "cluster_id:in:2,3", false],
  [{}, "is_representative:eq:true", true],
  [{}, "is_representative:eq:false", false],
  [{ cost_usd_z: -2.5 }, "cost_usd_z:absgte:2", true],
  [{ cost_usd_z: 1.9 }, "cost_usd_z:absgte:2", false],
];

describe("parsePredicate", () => {
  it.each(GOLDEN_PARSE)("parses %s", (raw, column, op, values) => {
    const p = parsePredicate(raw);
    expect([p.column, p.op, p.values]).toEqual([column, op, values]);
  });

  it.each(GOLDEN_REJECT)("rejects %s", (raw) => {
    expect(() => parsePredicate(raw)).toThrow();
  });

  it.each(GOLDEN_PARSE)("round-trips %s", (raw) => {
    expect(serializePredicate(parsePredicate(raw))).toBe(raw);
  });
});

describe("predicateMatches truth table", () => {
  it.each(MATCH_TABLE)("row %o with %s -> %s", (overrides, raw, expected) => {
    const row = { ...BASE_ROW, ...overrides };
    const p = parsePredicate(raw);
    expect(predicateMatches(row[p.column], p, RUN_KINDS[p.column]!)).toBe(expected);
  });

  it("compilePredicates ANDs", () => {
    const preds = [
      parsePredicate("outcome:eq:pass"),
      parsePredicate("total_tokens:gte:20000"),
    ];
    expect(compilePredicates(preds, RUN_KINDS)(BASE_ROW)).toBe(false);
    preds[1] = parsePredicate("total_tokens:gte:10000");
    expect(compilePredicates(preds, RUN_KINDS)(BASE_ROW)).toBe(true);
  });
});

describe("percentile (matches backend metrics._percentile)", () => {
  it("linear interpolation", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 10);
    expect(percentile([1, 2, 3, 4], 0.95)).toBeCloseTo(3.85, 10);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.95)).toBe(0);
  });
});
