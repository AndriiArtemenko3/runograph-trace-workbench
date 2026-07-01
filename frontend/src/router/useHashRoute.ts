import { useEffect, useState } from "react";

/** The four workbench sheets. Hash routes map 1:1; the bare hash falls
 *  back to the runs sheet. */
export type SheetView = "runs" | "steps" | "clusters" | "edges";

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

function parseHash(): SheetView {
  const h = window.location.hash;
  return ROUTES[h] ?? "runs";
}

/**
 * Hash-based router for the workbench sheets. Reads `window.location.hash`
 * on mount, listens for `hashchange`, returns the active sheet + a setter
 * that pushes the new hash.
 */
export function useHashRoute(): [SheetView, (v: SheetView) => void] {
  const [view, setView] = useState<SheetView>(() => parseHash());

  useEffect(() => {
    const onChange = () => setView(parseHash());
    onChange();
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = (next: SheetView) => {
    const path = PATH_BY_VIEW[next];
    if (window.location.hash !== path) {
      window.location.hash = path;
    } else {
      setView(next);
    }
  };

  return [view, navigate];
}
