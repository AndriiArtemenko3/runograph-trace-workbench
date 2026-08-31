/**
 * Per-run route content index — client twin of the route.* pseudo-column
 * evaluation in backend run_filter._route_matches. Built once from the
 * steps sheet rows (already timestamp-ordered per run with seq_idx).
 */

import type { StepRow } from "../api/tables";
import { asciiFold, EDGE_SEPARATOR } from "./predicate";
import type { Predicate } from "./predicate";

export interface RouteIndex {
  targetsByRun: Map<string, string[]>;
  typesByRun: Map<string, Set<string>>;
  edgesByRun: Map<string, Set<string>>; // "source>target" keys
}

export function buildRouteIndex(steps: StepRow[]): RouteIndex {
  const targetsByRun = new Map<string, string[]>();
  const typesByRun = new Map<string, Set<string>>();
  const edgesByRun = new Map<string, Set<string>>();
  // steps arrive grouped by run and ordered by seq_idx (builder contract)
  for (const s of steps) {
    let targets = targetsByRun.get(s.run_id);
    if (!targets) {
      targets = [];
      targetsByRun.set(s.run_id, targets);
      typesByRun.set(s.run_id, new Set());
      edgesByRun.set(s.run_id, new Set());
    }
    if (targets.length > 0) {
      edgesByRun
        .get(s.run_id)!
        .add(`${targets[targets.length - 1]}${EDGE_SEPARATOR}${s.target}`);
    }
    targets.push(s.target);
    typesByRun.get(s.run_id)!.add(s.event_type);
  }
  return { targetsByRun, typesByRun, edgesByRun };
}

export function isRoutePredicate(p: Predicate): boolean {
  return p.column.startsWith("route.");
}

export function routePredicateMatches(
  idx: RouteIndex,
  runId: string,
  p: Predicate,
): boolean {
  if (p.column === "route.target") {
    const targets = idx.targetsByRun.get(runId) ?? [];
    if (p.op === "eq") return targets.includes(p.values[0]!);
    const needle = asciiFold(p.values[0]!);
    return targets.some((target) => asciiFold(target).includes(needle));
  }
  if (p.column === "route.event_type") {
    const types = idx.typesByRun.get(runId);
    return p.values.some((v) => types?.has(v) ?? false);
  }
  if (p.column === "route.edge") {
    return idx.edgesByRun.get(runId)?.has(p.values[0]!) ?? false;
  }
  return false;
}
