import { SolverGrid } from "./pages/SolverGrid";

/**
 * Root route — single Solver Grid view for v0.3 alpha.
 *
 * Heat-map / Stage-tree / Editor pages mount here once they port over
 * (commits after Path B's first 10). Hash-based switching gets added
 * when the second page lands; one page does not need a router.
 */
export default function App() {
  return <SolverGrid />;
}
