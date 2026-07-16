import { businessConfig, formatMoney } from '@/config/business.config';

export { formatMoney };

/** Format an ISO date/datetime as e.g. "Jul 14, 2026". Returns "—" on empty/invalid. */
export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(businessConfig.currency.locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/** Format an ISO datetime with time, e.g. "Jul 14, 8:00 AM". */
export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(businessConfig.currency.locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

/** Human "time ago"/"in" label from an ISO timestamp, relative to a base (default now). */
export function relativeTime(iso: string | undefined | null, baseMs: number = Date.now()): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = d.getTime() - baseMs;
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(businessConfig.currency.locale, { numeric: 'auto' });
  const mins = Math.round(diffMs / 60000);
  const hours = Math.round(diffMs / 3_600_000);
  const days = Math.round(diffMs / 86_400_000);
  if (abs < 3_600_000) return rtf.format(mins, 'minute');
  if (abs < 86_400_000) return rtf.format(hours, 'hour');
  return rtf.format(days, 'day');
}

/** Turn a snake/lower status into Title Case words, e.g. "in_progress" → "In Progress". */
export function humanizeStatus(status: string): string {
  return status
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Tailwind classes for a status badge, by rough semantic bucket. */
export function statusTone(status: string): string {
  const positive = ['paid', 'approved', 'converted', 'complete', 'received', 'won'];
  const warn = ['past_due', 'awaiting_response', 'partial', 'needed', 'sent', 'contacted', 'quoted'];
  const active = ['in_progress', 'scheduled', 'ordered', 'new'];
  const muted = ['archived', 'draft', 'lost', 'bad_debt', 'unknown'];
  if (positive.includes(status)) return 'bg-emerald-100 text-emerald-800';
  if (warn.includes(status)) return 'bg-amber-100 text-amber-800';
  if (active.includes(status)) return 'bg-sky-100 text-sky-800';
  if (muted.includes(status)) return 'bg-slate-100 text-slate-600';
  return 'bg-slate-100 text-slate-600';
}
