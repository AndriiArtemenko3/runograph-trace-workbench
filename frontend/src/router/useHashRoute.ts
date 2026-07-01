import { useEffect, useState } from "react";
import type { SolverView } from "../components/ViewSwitcher";

/** Active hash routes for the 4 solver views. The historical `#/matrix`
 *  hash is preserved as a legacy alias that resolves to "routes" — old
 *  bookmarks open the new aggregate page rather than 404. */
const ROUTES: Record<string, SolverView> = {
  "": "routes",
  "#": "routes",
  "#/": "routes",
  "#/routes": "routes",
  "#/matrix": "routes", // legacy alias
  "#/heatmap": "heatmap",
  "#/stagetree": "stagetree",
  "#/editor": "editor",
};

const PATH_BY_VIEW: Record<SolverView, string> = {
  routes: "#/routes",
  heatmap: "#/heatmap",
  stagetree: "#/stagetree",
  editor: "#/editor",
};

function parseHash(): SolverView {
  const h = window.location.hash;
  return ROUTES[h] ?? "routes";
}

/**
 * Hash-based router for the 4 solver views. Reads `window.location.hash`
 * on mount, listens for `hashchange`, returns the active view + a setter
 * that pushes the new hash.
 *
 * Side effect on mount: if the URL hash is the legacy `#/matrix`, the
 * setter is invoked to rewrite to `#/routes` so subsequent navigation
 * stays canonical.
 */
export function useHashRoute(): [SolverView, (v: SolverView) => void] {
  const [view, setView] = useState<SolverView>(() => parseHash());

  useEffect(() => {
    // Normalize legacy `#/matrix` to the canonical `#/routes` both on
    // initial mount and any time the user navigates to it mid-session.
    const normalize = () => {
      if (window.location.hash === "#/matrix") {
        window.history.replaceState(null, "", "#/routes");
        setView("routes");
      } else {
        setView(parseHash());
      }
    };
    normalize();
    window.addEventListener("hashchange", normalize);
    return () => window.removeEventListener("hashchange", normalize);
  }, []);

  const navigate = (next: SolverView) => {
    const path = PATH_BY_VIEW[next];
    if (window.location.hash !== path) {
      window.location.hash = path;
    } else {
      setView(next);
    }
  };

  return [view, navigate];
}
