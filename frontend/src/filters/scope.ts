/**
 * Run scope: a pinned snapshot of run-level predicates (s= params) plus an
 * optional selected-run whitelist (runs= param). Both present → intersection.
 * Serialized in the hash query so scoped views are shareable.
 */

import { parsePredicate } from "./predicate";
import type { Predicate } from "./predicate";

export interface RunScope {
  predicates: Predicate[];
  runIds: string[] | null;
}

/** Max run ids serializable in the hash before the URL gets fragile. */
export const RUN_ID_SCOPE_CAP = 100;

export function isPublicId(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 128 &&
    /^[A-Za-z0-9]/.test(value) &&
    !/[^A-Za-z0-9._-]/.test(value)
  );
}

export interface ParsedFilters {
  preds: Predicate[];
  invalid: string[];
}

/** Parse many raw filter strings; invalid ones are collected, not thrown —
 *  the UI shows them as broken chips instead of silently mis-filtering. */
export function parseMany(raw: string[]): ParsedFilters {
  const preds: Predicate[] = [];
  const invalid: string[] = [];
  for (const r of raw) {
    try {
      preds.push(parsePredicate(r));
    } catch {
      invalid.push(r);
    }
  }
  return { preds, invalid };
}

export function parseRunIds(raw: string | null): string[] | null {
  if (raw === null) return null;
  const ids = raw.split(",");
  if (ids.length === 0 || ids.some((id) => id.length === 0)) {
    throw new Error("runs=: no run ids");
  }
  if (ids.some((id) => !isPublicId(id))) {
    throw new Error(
      "runs=: invalid run id; expected 1-128 ASCII letters, digits, '.', '_' or '-'",
    );
  }
  return [...new Set(ids)];
}
