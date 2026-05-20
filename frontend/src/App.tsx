import { SolverGrid } from "./pages/SolverGrid";
import { HeatMap } from "./pages/HeatMap";
import { StageTree } from "./pages/StageTree";
import { Editor } from "./pages/Editor";
import { Routes } from "./pages/Routes";
import { useHashRoute } from "./router";

/**
 * App root — hash-routed between the 4 solver views.
 *
 * The ViewSwitcher inside AppShell mutates the same hash via
 * useHashRoute, so clicking a tab swaps the page without remounting
 * the chrome.
 */
export default function App() {
  const [view] = useHashRoute();
  switch (view) {
    case "heatmap":
      return <HeatMap />;
    case "stagetree":
      return <StageTree />;
    case "editor":
      return <Editor />;
    case "routes":
      return <Routes />;
    case "matrix":
    default:
      return <SolverGrid />;
  }
}
