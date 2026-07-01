import { useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { shortLabel } from "./_classify";
import { LAYOUT, THEME } from "./_layout";

// Edges always pass through verbatim; nodes route through the canonical
// shortLabel so the popover header reads the same string as the inspector,
// breadcrumb, and action label.
function shortLabelForCtx(kind: "node" | "edge", id: string): string {
  return kind === "node" ? shortLabel(id) : id;
}

export interface ContextMenuPopoverProps {
  x: number;
  y: number;
  target: { kind: "node" | "edge"; id: string };
  onClose: () => void;
  onAction: (action: "pin", target: { kind: "node" | "edge"; id: string }) => void;
}

export function ContextMenuPopover({ x, y, target, onClose, onAction }: ContextMenuPopoverProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [clampedXY, setClampedXY] = useState<{ x: number; y: number }>({ x, y });
  const [focusedIdx, setFocusedIdx] = useState<number>(0);
  useEffect(() => {
    const handler = (ev: MouseEvent) => {
      const el = ev.target as HTMLElement | null;
      if (el && el.closest("[data-ctx-menu]")) return;
      onClose();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose]);

  const items: Array<{ label: string; onClick: () => void; disabled?: boolean }> = [
    { label: "Pin selection", onClick: () => { onAction("pin", target); onClose(); } },
  ];

  // Viewport-clamp the popover anchor so near-edge nodes + sub-1280px
  // viewports don't push the menu off-screen. Measure post-mount, then
  // shift to fit. 8px gutter mirrors the LegendInline + Inspector spacing.
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) {
      setClampedXY({ x, y });
      return;
    }
    const r = el.getBoundingClientRect();
    const cx = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const cy = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
    setClampedXY({ x: cx, y: cy });
  }, [x, y]);

  // Focus the first enabled menu item on open + capture the invoking element
  // so we can restore focus to it on close (WAI-ARIA menu pattern).
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    const firstEnabled = items.findIndex((it) => !it.disabled);
    if (firstEnabled >= 0) {
      setFocusedIdx(firstEnabled);
      itemRefs.current[firstEnabled]?.focus();
    }
    return () => {
      const el = triggerRef.current;
      if (el && el.isConnected) {
        el.focus({ preventScroll: true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveFocus = (dir: 1 | -1) => {
    const n = items.length;
    let i = focusedIdx;
    for (let step = 0; step < n; step++) {
      i = (i + dir + n) % n;
      if (!items[i]?.disabled) break;
    }
    setFocusedIdx(i);
    itemRefs.current[i]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
    else if (e.key === "Home") {
      e.preventDefault();
      const i = items.findIndex((it) => !it.disabled);
      if (i >= 0) { setFocusedIdx(i); itemRefs.current[i]?.focus(); }
    }
    else if (e.key === "End") {
      e.preventDefault();
      let i = -1;
      for (let k = items.length - 1; k >= 0; k--) {
        if (!items[k]?.disabled) { i = k; break; }
      }
      if (i >= 0) { setFocusedIdx(i); itemRefs.current[i]?.focus(); }
    }
    else if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
  };

  return (
    <div
      data-ctx-menu
      ref={popoverRef}
      role="menu"
      aria-label={(() => {
        if (target.kind === "edge") {
          const [s, t] = target.id.split("->");
          return `Actions for edge from ${s ?? ""} to ${t ?? ""}`;
        }
        const label =
          target.id.length > 36 ? target.id.slice(0, 33) + "…" : target.id;
        return `Actions for node ${label}`;
      })()}
      className="fixed z-50 min-w-[180px] py-1 rounded-md bg-white border border-[rgba(216,216,220,1)] shadow-lg"
      style={{ left: clampedXY.x, top: clampedXY.y, fontSize: LAYOUT.fontSize.ctxMenu }}
      onKeyDown={onKeyDown}
    >
      <div className="px-3 py-1 text-[10px] font-mono" style={{ maxWidth: LAYOUT.prose.truncatedRowMaxWidth, color: THEME.subtleText }} title={target.id}>
        {target.kind === "edge" ? (
          (() => {
            const [s, t] = target.id.split("->");
            return (
              <>
                <div className="truncate">{s}</div>
                <div className="truncate">↓ {t ?? ""}</div>
              </>
            );
          })()
        ) : (
          <div className="truncate">{target.kind}: {shortLabelForCtx(target.kind, target.id)}</div>
        )}
      </div>
      <div className="h-px bg-[rgba(232,232,236,1)] my-0.5" />
      {items.map((it, idx) => (
        <button
          key={it.label}
          ref={(el) => { itemRefs.current[idx] = el; }}
          role="menuitem"
          disabled={it.disabled}
          tabIndex={idx === focusedIdx ? 0 : -1}
          onClick={it.onClick}
          className={clsx(
            "block w-full text-left px-3 py-1.5 hover:bg-[rgba(245,245,247,1)]",
            "focus-visible:bg-[rgba(245,245,247,1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8C59D9] focus-visible:outline-offset-[-2px]",
            it.disabled && "cursor-not-allowed hover:bg-transparent",
          )}
          style={it.disabled ? { color: THEME.subtleText } : { color: THEME.bodyText }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
