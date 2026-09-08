import type { ReactNode } from 'react';

/**
 * Empty state — shown instead of a blank table when there's genuinely no data.
 * Copy should tell the user why it's empty and what to do next.
 */
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge bg-panel px-6 py-12 text-center">
      <svg
        viewBox="0 0 24 24"
        className="mb-3 h-8 w-8 text-ink-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <path d="M3 9.5 L6 4.5 L18 4.5 L21 9.5 L21 18.5 L3 18.5 Z" />
        <path d="M3 9.5 L9 9.5 C9 11.2 10.3 12.5 12 12.5 C13.7 12.5 15 11.2 15 9.5 L21 9.5" />
      </svg>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-3">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Inline skeleton rows for Suspense loading fallbacks. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-panel-2" />
      ))}
    </div>
  );
}

export function StatGridSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl bg-panel-2" />
      ))}
    </div>
  );
}
