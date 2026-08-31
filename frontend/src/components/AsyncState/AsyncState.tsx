import type { ReactNode } from "react";
import { clsx } from "clsx";

import type { AsyncState } from "../../api/routes";

export type NoticeTone = "loading" | "empty" | "error";

interface StateNoticeProps {
  tone: NoticeTone;
  title: string;
  detail?: string;
  diagnostic?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Compact state panel that uses the existing Workbench surface/status tokens. */
export function StateNotice({
  tone,
  title,
  detail,
  diagnostic,
  actionLabel,
  onAction,
}: StateNoticeProps) {
  const isError = tone === "error";
  return (
    <section
      role={isError ? "alert" : "status"}
      aria-live="polite"
      aria-busy={tone === "loading" ? true : undefined}
      className={clsx(
        "max-w-2xl rounded border bg-bg-panel px-4 py-4",
        isError ? "border-status-danger/40" : "border-border-hairline",
      )}
    >
      <p
        className={clsx(
          "font-mono text-sm",
          isError ? "text-status-danger" : "text-text-primary",
        )}
      >
        {title}
      </p>
      {detail && <p className="mt-1 text-sm text-text-secondary">{detail}</p>}
      {diagnostic && (
        <code className="mt-2 block break-words font-mono text-xs text-text-secondary">
          {diagnostic}
        </code>
      )}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-3 rounded border border-border-subtle px-2 py-1 font-mono text-xs text-text-secondary hover:border-border-strong hover:text-text-primary"
        >
          {actionLabel}
        </button>
      )}
    </section>
  );
}

interface AsyncBoundaryProps<T> {
  state: AsyncState<T>;
  label: string;
  loadingTitle?: string;
  errorTitle?: string;
  errorDetail?: string;
  children: (data: T) => ReactNode;
}

/** Render request loading/error states and expose ready data to the caller. */
export function AsyncBoundary<T>({
  state,
  label,
  loadingTitle,
  errorTitle,
  errorDetail = "The API request did not complete. Check the service and try again.",
  children,
}: AsyncBoundaryProps<T>) {
  if (state.status === "loading") {
    return (
      <StateNotice tone="loading" title={loadingTitle ?? `Loading ${label}…`} />
    );
  }
  if (state.status === "error") {
    return (
      <StateNotice
        tone="error"
        title={errorTitle ?? `Unable to load ${label}`}
        detail={errorDetail}
        diagnostic={state.error}
        actionLabel="Retry"
        onAction={state.retry}
      />
    );
  }
  return <>{children(state.data)}</>;
}

interface AsyncCollectionProps<T>
  extends Omit<AsyncBoundaryProps<T[]>, "children"> {
  emptyTitle: string;
  emptyDetail: string;
  children: (data: T[]) => ReactNode;
}

/** Async boundary with an explicit, refreshable state for an empty response. */
export function AsyncCollection<T>({
  state,
  emptyTitle,
  emptyDetail,
  children,
  ...boundaryProps
}: AsyncCollectionProps<T>) {
  return (
    <AsyncBoundary state={state} {...boundaryProps}>
      {(data) =>
        data.length === 0 ? (
          <StateNotice
            tone="empty"
            title={emptyTitle}
            detail={emptyDetail}
            actionLabel="Refresh"
            onAction={state.retry}
          />
        ) : (
          children(data)
        )
      }
    </AsyncBoundary>
  );
}
