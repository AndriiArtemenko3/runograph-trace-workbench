import { useEffect, useState } from "react";

/** The four workbench sheets. Hash routes map 1:1; the bare hash falls
 *  back to the runs sheet. */
export type SheetView = "runs" | "steps" | "clusters" | "edges";

/** Hash-query filter state. `f=` is sheet-local (drops on sheet switch);
 *  `s=` (run-scope predicates) and `runs=` (selection whitelist) persist
 *  across sheets. */
export interface HashParams {
  f: string[];
  s: string[];
  runs: string | null;
}

const ROUTES: Record<string, SheetView> = {
  "": "runs",
  "#": "runs",
  "#/": "runs",
  "#/runs": "runs",
  "#/steps": "steps",
  "#/clusters": "clusters",
  "#/edges": "edges",
};

const PATH_BY_VIEW: Record<SheetView, string> = {
  runs: "#/runs",
  steps: "#/steps",
  clusters: "#/clusters",
  edges: "#/edges",
};

// Minimal escaping keeps filter strings human-readable in the URL bar
// (URLSearchParams would percent-encode every ':'). Only characters that
// break hash-query parsing are escaped.
function enc(v: string): string {
  return v
    .replace(/%/g, "%25")
    .replace(/&/g, "%26")
    .replace(/#/g, "%23")
    .replace(/\+/g, "%2B")
    .replace(/=/g, "%3D")
    .replace(/ /g, "%20");
}

function parseHash(): { view: SheetView; params: HashParams } {
  const h = window.location.hash;
  const qIdx = h.indexOf("?");
  const path = qIdx === -1 ? h : h.slice(0, qIdx);
  const query = qIdx === -1 ? "" : h.slice(qIdx + 1);
  const sp = new URLSearchParams(query);
  return {
    view: ROUTES[path] ?? "runs",
    params: { f: sp.getAll("f"), s: sp.getAll("s"), runs: sp.get("runs") },
  };
}

function buildHash(view: SheetView, params: HashParams): string {
  const parts: string[] = [];
  for (const f of params.f) parts.push(`f=${enc(f)}`);
  for (const s of params.s) parts.push(`s=${enc(s)}`);
  if (params.runs) parts.push(`runs=${enc(params.runs)}`);
  const query = parts.join("&");
  return PATH_BY_VIEW[view] + (query ? `?${query}` : "");
}

/**
 * Hash router for the workbench: sheet + filter/scope params, with the
 * hash as the single source of truth (back/forward and pasted URLs work).
 * `navigate` switches sheets (keeping scope, dropping sheet-local `f=`);
 * `setParams` patches params on the current sheet.
 */
export function useHashRoute(): [
  SheetView,
  HashParams,
  (v: SheetView) => void,
  (patch: Partial<HashParams>) => void,
] {
  const [state, setState] = useState(parseHash);

  useEffect(() => {
    const onChange = () => setState(parseHash());
    onChange();
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const apply = (view: SheetView, params: HashParams) => {
    const target = buildHash(view, params);
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
  };

  const navigate = (next: SheetView) => {
    apply(next, { ...state.params, f: [] });
  };

  const setParams = (patch: Partial<HashParams>) => {
    apply(state.view, { ...state.params, ...patch });
  };

  return [state.view, state.params, navigate, setParams];
}
