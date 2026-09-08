import type { ReactNode } from 'react';
import { humanizeStatus, statusTone } from './format';

/** Page title + optional description and right-aligned actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A KPI tile. Used in the responsive stat grid. */
export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'positive' | 'negative';
}) {
  const valueTone =
    tone === 'positive' ? 'text-emerald-700' : tone === 'negative' ? 'text-red-600' : 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      {/* tabular-nums keeps money and counts from jittering as digits change. */}
      <div className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${valueTone}`}>{value}</div>
      {/* slate-500, not 400: the hint is what explains the number, and 400 on
          white fails WCAG contrast — unreadable on a phone in sunlight. */}
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

/**
 * `cols` matches the tile count so three tiles don't leave a hole in a
 * four-column grid (classes written out literally for the Tailwind compiler).
 */
export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const colsClass = cols === 2 ? 'lg:grid-cols-2' : cols === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4';
  return <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${colsClass}`}>{children}</div>;
}

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-700">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusTone(status)}`}
    >
      {humanizeStatus(status)}
    </span>
  );
}

/**
 * Horizontally-scrollable table wrapper — the table never forces the page body
 * to scroll sideways on mobile; it scrolls inside its own container.
 *
 * Focusable + labeled region so keyboard users can reach and scroll it (a bare
 * overflow div can't take focus, which made wide tables keyboard-dead), and a
 * slim visible scrollbar so phone users can tell columns continue off-screen.
 */
export function TableWrap({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={label ?? 'Table (scrolls horizontally)'}
      className="table-scroll -mx-4 overflow-x-auto sm:mx-0"
    >
      <div className="inline-block min-w-full align-middle">{children}</div>
    </div>
  );
}
