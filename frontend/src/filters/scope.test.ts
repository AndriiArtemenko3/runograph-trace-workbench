import { describe, expect, it } from "vitest";

import { isPublicId, parseRunIds } from "./scope";

describe("public identifier and run whitelist contract", () => {
  it.each(["a", "run-1", "task_2", "exp.v3"])("accepts %s", (value) => {
    expect(isPublicId(value)).toBe(true);
  });

  it.each([
    "",
    "a,b",
    "a/b",
    "../escape",
    "-leading",
    "line-break\n",
    "unicode-é",
    "a".repeat(129),
  ])(
    "rejects %s",
    (value) => {
      expect(isPublicId(value)).toBe(false);
    },
  );

  it("round-trips and deduplicates exact safe comma-separated run IDs", () => {
    expect(parseRunIds("run-a,run-b,run-a")).toEqual(["run-a", "run-b"]);
  });

  it.each([",,,", "run-a,../escape", "a/b", "a,b,c/unsafe", "run-a, run-b"])(
    "fails closed for %s",
    (raw) => {
      expect(() => parseRunIds(raw)).toThrow();
    },
  );
});
