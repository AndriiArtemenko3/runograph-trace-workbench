import { useHashRoute } from "./router";
import type { SheetView } from "./router";

const SHEETS: SheetView[] = ["runs", "steps", "clusters", "edges"];

/**
 * App root — placeholder shell for the workbench sheets. The DataTable
 * views land in phase 3; until then each sheet renders a stub so the
 * shell, router, and tokens stay verifiable end-to-end.
 */
export default function App() {
  const [view, navigate] = useHashRoute();
  return (
    <div className="min-h-screen bg-bg-canvas p-6 text-text-primary">
      <header className="mb-6 flex items-center gap-6">
        <h1 className="text-lg font-mono">RunoGraph</h1>
        <nav className="flex gap-2">
          {SHEETS.map((s) => (
            <button
              key={s}
              onClick={() => navigate(s)}
              className={
                s === view
                  ? "rounded bg-bg-elevated px-3 py-1 text-sm text-text-primary"
                  : "rounded px-3 py-1 text-sm text-text-secondary hover:text-text-primary"
              }
            >
              {s}
            </button>
          ))}
        </nav>
      </header>
      <main className="rounded border border-border-hairline bg-bg-panel p-6">
        <p className="font-mono text-sm text-text-secondary">
          {view} — table view lands in phase 3. Use scripts/export_runs.py for
          CSV exports meanwhile.
        </p>
      </main>
    </div>
  );
}
