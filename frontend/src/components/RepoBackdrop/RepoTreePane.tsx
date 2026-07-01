import { useMemo, useState } from "react";
import clsx from "clsx";
import type { RepoTreeNode } from "../../api/routes";

/**
 * Repo-tree side pane — collapsible file hierarchy with per-file visit
 * counts. Auto-expands the directories the agent touched on first render
 * so the surface is immediately useful; everything else stays collapsed
 * to keep the pane scrollable for a 3000-file repo.
 *
 * Search box up top filters live across both dirs (any descendant matches)
 * and files (name match).
 *
 * Replaces the experiment-overview right pane on the Routes page when
 * repoView === "tree-pane". The user gets the file-system as the right
 * pane; trade-off is the experiment indicators move out of view, but
 * the bottom-bar still shows the headline numbers.
 */

export interface RepoTreePaneProps {
  tree: RepoTreeNode;
  fileCount: number;
  touchedCount: number;
  className?: string;
}

function dirsWithVisits(node: RepoTreeNode, acc: Set<string>, path = ""): void {
  const fullPath = path ? `${path}/${node.name}` : node.name;
  if (node.kind === "dir") {
    if (node.totalVisits > 0 && node.name) acc.add(fullPath);
    for (const c of node.children ?? []) dirsWithVisits(c, acc, fullPath);
  }
}

function nodeMatchesQuery(node: RepoTreeNode, q: string): boolean {
  if (!q) return true;
  if (node.kind === "file") return node.name.toLowerCase().includes(q);
  // Dir: matches if any descendant matches (recursive cheap walk)
  return (node.children ?? []).some((c) => nodeMatchesQuery(c, q));
}

interface TreeRowProps {
  node: RepoTreeNode;
  depth: number;
  fullPath: string;
  expanded: Set<string>;
  setExpanded: (next: Set<string>) => void;
  query: string;
}

function TreeRow({
  node,
  depth,
  fullPath,
  expanded,
  setExpanded,
  query,
}: TreeRowProps) {
  if (!nodeMatchesQuery(node, query)) return null;
  const isDir = node.kind === "dir";
  const isOpen = expanded.has(fullPath) || (!!query && query.length > 0);
  const indent = depth * 12;

  if (isDir) {
    const visits = node.totalVisits;
    const fileCount = node.totalFiles;
    return (
      <>
        <button
          type="button"
          onClick={() => {
            const next = new Set(expanded);
            if (next.has(fullPath)) next.delete(fullPath);
            else next.add(fullPath);
            setExpanded(next);
          }}
          className={clsx(
            "flex items-center w-full text-left py-0.5 hover:bg-bg-elevated",
            "font-mono text-xs",
          )}
          style={{ paddingLeft: 8 + indent }}
        >
          <span className="text-text-tertiary w-3 shrink-0">
            {isOpen ? "▾" : "▸"}
          </span>
          <span
            className={clsx(
              "truncate",
              visits > 0 ? "text-text-primary" : "text-text-secondary",
            )}
          >
            {node.name || "(root)"}
          </span>
          <span className="ml-auto text-[10px] text-text-tertiary pl-2 pr-2 shrink-0">
            {visits > 0 ? `${visits}v / ${fileCount}f` : `${fileCount}f`}
          </span>
        </button>
        {isOpen
          ? (node.children ?? []).map((c) => (
              <TreeRow
                key={`${fullPath}/${c.name}`}
                node={c}
                depth={depth + 1}
                fullPath={`${fullPath}/${c.name}`}
                expanded={expanded}
                setExpanded={setExpanded}
                query={query}
              />
            ))
          : null}
      </>
    );
  }
  // Leaf file
  const visits = node.visits;
  const touched = visits > 0;
  return (
    <div
      className={clsx(
        "flex items-center py-0.5",
        touched ? "" : "opacity-50",
      )}
      style={{ paddingLeft: 8 + indent + 12 }}
    >
      <span
        className={clsx(
          "font-mono text-xs truncate",
          touched ? "text-accent-primary" : "text-text-secondary",
        )}
      >
        {node.name}
      </span>
      {touched ? (
        <span className="ml-auto text-[10px] font-mono text-accent-primary pr-2 shrink-0">
          {visits}v
        </span>
      ) : null}
    </div>
  );
}

export function RepoTreePane({
  tree,
  fileCount,
  touchedCount,
  className,
}: RepoTreePaneProps) {
  // Auto-expand dirs that have any agent visits, plus their ancestors so the
  // user lands on the touched paths without having to drill down manually.
  const initialExpanded = useMemo(() => {
    const dirs = new Set<string>();
    dirsWithVisits(tree, dirs);
    // Also expand each prefix of every dir-with-visits
    const out = new Set<string>();
    for (const d of dirs) {
      const parts = d.split("/").filter(Boolean);
      let acc = "";
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        out.add(acc);
      }
    }
    return out;
  }, [tree]);

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  const [query, setQuery] = useState("");

  return (
    <aside
      aria-label="Repo tree"
      className={clsx(
        "w-[320px] shrink-0 bg-bg-panel border-l border-border-hairline flex flex-col overflow-hidden",
        className,
      )}
    >
      <div className="px-3 pt-3 pb-2 border-b border-border-hairline">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="font-sans text-sm font-medium text-text-primary">
            Repository
          </h3>
          <span className="font-mono text-xs text-text-tertiary">
            {touchedCount}/{fileCount}
          </span>
        </div>
        <input
          type="text"
          placeholder="Filter files…"
          value={query}
          onChange={(e) => setQuery(e.target.value.toLowerCase())}
          className={clsx(
            "w-full bg-bg-canvas border border-border-hairline rounded-sm",
            "px-2 py-1 font-mono text-xs text-text-primary",
            "focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-accent-primary",
          )}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {(tree.children ?? []).map((c) => (
          <TreeRow
            key={c.name}
            node={c}
            depth={0}
            fullPath={c.name}
            expanded={expanded}
            setExpanded={setExpanded}
            query={query}
          />
        ))}
      </div>
    </aside>
  );
}
