import { AppShell } from "./AppShell";

/**
 * Stage-tree page — the 5-stage pipeline with model-candidate cards
 * per stage. The demo's "I can see exactly why" beat (seconds 38-50).
 * Per the Q3 strategy: this is the load-bearing screen that makes
 * RunoGraph a category, not a feature.
 *
 * Stubbed in commit-11 (AppShell + routing); full implementation
 * lands in commit-13.
 */
export function StageTree() {
  return (
    <AppShell
      crumb="/ 05 Stage-tree"
      pageTitle="RunoGraph Stage-tree"
      weightProfile="balanced"
      bottomLeft={[
        { tone: "info", label: "stages", detail: "5 · edit selected" },
        { tone: "success", label: "Top: Harness B", detail: "+0.52 · 94% pass" },
      ]}
      bottomRight={[
        { tone: "success", label: "v0.3-alpha", detail: "14:22" },
      ]}
    >
      <section className="flex-1 min-w-0 flex items-center justify-center text-text-secondary font-mono text-sm">
        Stage-tree view — 5-stage pipeline + model-candidate grid lands in commit 13.
      </section>
    </AppShell>
  );
}
