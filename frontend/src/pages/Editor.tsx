import { AppShell } from "./AppShell";

/**
 * Editor page — node editor with xyflow for visual harness composition.
 * The demo's "I declare two harness configs as a YAML file" beat
 * (seconds 3-12). Per the demo script: visible in the recording but
 * does NOT need full interactivity in v0.3.
 *
 * Stubbed in commit-11 (AppShell + routing); full implementation
 * lands in commit-14.
 */
export function Editor() {
  return (
    <AppShell
      crumb="/ 07 Editor"
      pageTitle="RunoGraph Editor"
      weightProfile="balanced"
      bottomLeft={[
        { tone: "info", label: "nodes", detail: "12 · 2 unsaved" },
        { tone: "warning", label: "unsynced", detail: "press ⌘S to save" },
      ]}
      bottomRight={[
        { tone: "success", label: "v0.3-alpha", detail: "14:22" },
      ]}
    >
      <section className="flex-1 min-w-0 flex items-center justify-center text-text-secondary font-mono text-sm">
        Editor view — xyflow node editor + YAML serialize lands in commit 14.
      </section>
    </AppShell>
  );
}
