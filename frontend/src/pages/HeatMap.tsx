import { AppShell } from "./AppShell";

/**
 * Heat-map page — corpus map view. The 60-second demo's "I see the agent
 * actually move through the repo" beat (seconds 12-25). 5 districts of
 * file tiles colored by HeatTile productivity / pollution, with a
 * numbered badge trail showing the agent's recent path.
 *
 * Stubbed in commit-11 (AppShell + routing); full implementation lands
 * in commit-12.
 */
export function HeatMap() {
  return (
    <AppShell
      crumb="/ 04 Heat-map"
      pageTitle="RunoGraph Heat-map"
      weightProfile="balanced"
      bottomLeft={[
        { tone: "info", label: "corpus", detail: "1,842 tiles · 7 districts" },
        { tone: "info", label: "agent path", detail: "5 of 12 steps" },
      ]}
      bottomRight={[
        { tone: "success", label: "v0.3-alpha", detail: "14:22" },
      ]}
    >
      <section className="flex-1 min-w-0 flex items-center justify-center text-text-secondary font-mono text-sm">
        Heat-map view — corpus tiles + agent path overlay land in commit 12.
      </section>
    </AppShell>
  );
}
