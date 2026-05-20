import { useEffect, useState } from "react";
import type { SolverView } from "../components/ViewSwitcher";

const ROUTES: Record<string, SolverView> = {
  "": "matrix",
  "#": "matrix",
  "#/matrix": "matrix",
  "#/heatmap": "heatmap",
  "#/stagetree": "stagetree",
  "#/editor": "editor",
};

const PATH_BY_VIEW: Record<SolverView, string> = {
  matrix: "#/matrix",
  heatmap: "#/heatmap",
  stagetree: "#/stagetree",
  editor: "#/editor",
};

function parseHash(): SolverView {
  const h = window.location.hash;
  return ROUTES[h] ?? "matrix";
}

/**
 * Hash-based router for the 4 solver views. Reads `window.location.hash`
 * on mount, listens for `hashchange`, and returns the active view + a
 * setter that pushes the new hash.
 *
 * Lives inline (no react-router dep yet) — the route table is closed
 * and small; if the page count grows past ~8 we move to react-router.
 */
export function useHashRoute(): [SolverView, (v: SolverView) => void] {
  const [view, setView] = useState<SolverView>(() => parseHash());

  useEffect(() => {
    const onChange = () => setView(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = (next: SolverView) => {
    const path = PATH_BY_VIEW[next];
    if (window.location.hash !== path) {
      window.location.hash = path;
    } else {
      // Already on this hash — still flip state so re-selecting the
      // active tab is a no-op rather than a missed setState.
      setView(next);
    }
  };

  return [view, navigate];
}
