import type { ReactNode } from "react";
import { TopBar } from "../components/composites/TopBar";
import { BottomBar, type BottomBarEntry } from "../components/composites/BottomBar";
import { useHashRoute } from "../router";

/**
 * Shared chrome shell — every solver page wraps its content in this.
 *
 * Provides: TopBar (with view-switcher wired to hash routing) + main
 * slot + BottomBar. Pages pass their own crumb, weight-profile label,
 * and bottom-bar entry clusters; everything else stays uniform.
 *
 * The chrome height adds up to canon (56 + 36 = 92 px), main fills the
 * remaining viewport.
 */

export interface AppShellProps {
  /** Crumb after the brand, e.g. \"/ 03 Solver Grid\". */
  crumb: string;
  /** Active weight-profile preset rendered in the top-bar chip. */
  weightProfile: string;
  /** Bottom-bar left cluster (infra status). */
  bottomLeft: BottomBarEntry[];
  /** Bottom-bar right cluster (telemetry). */
  bottomRight: BottomBarEntry[];
  /** Page-specific main body — fills the remaining viewport. */
  children: ReactNode;
  /** Optional global sr-only h1; defaults to the crumb. */
  pageTitle?: string;
}

export function AppShell({
  crumb,
  weightProfile,
  bottomLeft,
  bottomRight,
  children,
  pageTitle,
}: AppShellProps) {
  const [activeView, navigate] = useHashRoute();
  return (
    <div className="min-h-screen w-screen flex flex-col bg-bg-canvas text-text-primary">
      <h1 className="sr-only">{pageTitle ?? `RunoGraph ${crumb}`}</h1>
      <TopBar
        crumb={crumb}
        weightProfile={weightProfile}
        activeView={activeView}
        onViewChange={navigate}
      />
      <main className="flex-1 flex min-h-0">{children}</main>
      <BottomBar left={bottomLeft} right={bottomRight} />
    </div>
  );
}
