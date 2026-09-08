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
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Delta chip for KPI tiles: "+18% vs last month". Direction is semantic —
 * pass `good` for whether the movement is good for the business (a DROP in
 * spending is good), so color never lies.
 */
export function Delta({ label, good }: { label: string; good: boolean | null }) {
  const tone = good == null ? 'text-ink-4' : good ? 'text-good' : 'text-bad';
  return <span className={`text-xs font-medium ${tone}`}>{label}</span>;
}

/** A KPI tile. Used in the responsive stat grid. */
export function StatTile({
  label,
  value,
  hint,
  delta,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: ReactNode;
  tone?: 'default' | 'positive' | 'negative';
}) {
  const valueTone = tone === 'positive' ? 'text-good' : tone === 'negative' ? 'text-bad' : 'text-ink';
  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      {/* tabular-nums keeps money and counts from jittering as digits change. */}
      <div className={`rise-in mt-1 text-2xl font-semibold tracking-tight tabular-nums ${valueTone}`}>{value}</div>
      {(hint || delta) && (
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-ink-3">
          {hint && <span>{hint}</span>}
          {delta}
        </div>
      )}
    </div>
  );
}

/**
 * `cols` matches the tile count so three tiles don't leave a hole in a
 * four-column grid (classes written out literally for the Tailwind compiler).
 */
export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 6 }) {
  const colsClass =
    cols === 2
      ? 'lg:grid-cols-2'
      : cols === 3
        ? 'lg:grid-cols-3'
        : cols === 6
          ? 'sm:grid-cols-3 lg:grid-cols-6'
          : 'lg:grid-cols-4';
  return <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${colsClass}`}>{children}</div>;
}

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-edge bg-panel">
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-edge-soft px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-ink-2">{title}</h2>}
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
 * Business-health badge: Healthy / Watch / Attention. Reserved status colors,
 * always paired with a dot AND the word — never color alone.
 */
export type Health = 'healthy' | 'watch' | 'attention';

export function HealthBadge({ health }: { health: Health }) {
  const spec =
    health === 'healthy'
      ? { label: 'Healthy', cls: 'text-emerald-300 bg-emerald-400/10 ring-emerald-400/20', dot: 'bg-good' }
      : health === 'watch'
        ? { label: 'Watch', cls: 'text-amber-300 bg-amber-400/10 ring-amber-400/20', dot: 'bg-warn' }
        : { label: 'Attention', cls: 'text-red-300 bg-red-400/10 ring-red-400/20', dot: 'bg-bad' };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${spec.cls}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${spec.dot}`} />
      {spec.label}
    </span>
  );
}

/**
 * Horizontally-scrollable table wrapper — the table never forces the page body
 * to scroll sideways on mobile; it scrolls inside its own container.
 *
 * Focusable + labeled region so keyboard users can reach and scroll it, and a
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
