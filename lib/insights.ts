/**
 * Business insight engine — pure functions that turn the synced records into
 * the Command Center's KPIs, Business Pulse signals, and Attention items.
 *
 * Everything here is computed from REAL data at request time; nothing is
 * hard-coded or invented. Every function takes `now` so it is deterministic
 * and testable. Phase E moves the attention rules onto the automation engine;
 * the rule definitions here are the spec for that.
 */

import { businessConfig } from '@/config/business.config';
import type { Invoice, Job, Lead, MaterialTodo, Quote, Transaction } from '@/lib/db/types';

const TZ = businessConfig.contact.timezone;
const DAY_MS = 86_400_000;

// ── timezone-correct calendar helpers ────────────────────────────────────────

/** Year/month/day of an instant, in the BUSINESS timezone (not the server's). */
export function tzParts(iso: string | number | Date, tz: string = TZ): { y: number; m: number; d: number } {
  const date = iso instanceof Date ? iso : new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? 'UTC' : tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function sameMonth(a: { y: number; m: number }, b: { y: number; m: number }): boolean {
  return a.y === b.y && a.m === b.m;
}

function prevMonthOf(p: { y: number; m: number }): { y: number; m: number } {
  return p.m === 1 ? { y: p.y - 1, m: 12 } : { y: p.y, m: p.m - 1 };
}

function ageDays(iso: string | undefined, nowMs: number): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((nowMs - t) / DAY_MS);
}

// ── KPIs ─────────────────────────────────────────────────────────────────────

/**
 * Open pipeline = quotes sitting with the customer (awaiting_response).
 * Weighted pipeline applies a single documented probability to that stage —
 * a rough planning number, not a forecast; stage-level probabilities arrive
 * with the real pipeline board.
 */
export const PIPELINE_WEIGHT = 0.4;

export interface KpiSummary {
  invoicedMtd: number;
  /** Prior month, through the same day-of-month — a fair pace comparison. */
  invoicedPrevPace: number;
  invoicedYtd: number;
  collectedMtd: number;
  pipelineValue: number;
  pipelineCount: number;
  weightedPipeline: number;
  arOutstanding: number;
  arOverdue: number;
  arOverdueCount: number;
  activeJobs: number;
  activeJobsValue: number;
  newLeads: number;
  spendMtd: number;
}

/** Balance still owed on an invoice that is actually collectible. */
export function invoiceBalance(i: Invoice): number {
  if (i.status === 'draft' || i.status === 'bad_debt' || i.status === 'unknown') return 0;
  return Math.max(0, i.amount - i.amountPaid);
}

export function isOverdue(i: Invoice, nowMs: number): boolean {
  if (invoiceBalance(i) <= 0) return false;
  if (i.status === 'past_due') return true;
  if (!i.dueAt) return false;
  const due = new Date(i.dueAt).getTime();
  return Number.isFinite(due) && due < nowMs;
}

export function computeKpis(
  data: {
    jobs: Job[];
    quotes: Quote[];
    invoices: Invoice[];
    leads: Lead[];
    transactions: Transaction[];
  },
  now: Date = new Date(),
): KpiSummary {
  const nowP = tzParts(now);
  const prevP = prevMonthOf(nowP);
  const nowMs = now.getTime();

  let invoicedMtd = 0;
  let invoicedPrevPace = 0;
  let invoicedYtd = 0;
  let collectedMtd = 0;
  let arOutstanding = 0;
  let arOverdue = 0;
  let arOverdueCount = 0;

  for (const inv of data.invoices) {
    if (inv.status === 'draft' || inv.status === 'unknown') continue;
    if (inv.issuedAt) {
      const p = tzParts(inv.issuedAt);
      if (sameMonth(p, nowP)) {
        invoicedMtd += inv.amount;
        collectedMtd += inv.amountPaid;
      }
      if (sameMonth(p, prevP) && p.d <= nowP.d) invoicedPrevPace += inv.amount;
      if (p.y === nowP.y) invoicedYtd += inv.amount;
    }
    const bal = invoiceBalance(inv);
    arOutstanding += bal;
    if (isOverdue(inv, nowMs)) {
      arOverdue += bal;
      arOverdueCount += 1;
    }
  }

  const openQuotes = data.quotes.filter((q) => q.status === 'awaiting_response');
  const pipelineValue = openQuotes.reduce((s, q) => s + q.amount, 0);

  const active = data.jobs.filter((j) => j.status === 'in_progress' || j.status === 'scheduled');

  let spendMtd = 0;
  for (const t of data.transactions) {
    if (t.date && sameMonth(tzParts(t.date), nowP)) spendMtd += Math.abs(t.amount);
  }

  return {
    invoicedMtd,
    invoicedPrevPace,
    invoicedYtd,
    collectedMtd,
    pipelineValue,
    pipelineCount: openQuotes.length,
    weightedPipeline: pipelineValue * PIPELINE_WEIGHT,
    arOutstanding,
    arOverdue,
    arOverdueCount,
    activeJobs: active.length,
    activeJobsValue: active.reduce((s, j) => s + j.value, 0),
    newLeads: data.leads.filter((l) => l.status === 'new').length,
    spendMtd,
  };
}

// ── Business Pulse ───────────────────────────────────────────────────────────

export type Health = 'healthy' | 'watch' | 'attention';

export interface PulseSignal {
  key: string;
  label: string;
  health: Health;
  /** One human sentence explaining WHY, from real numbers. */
  detail: string;
}

const money = (n: number) =>
  new Intl.NumberFormat(businessConfig.currency.locale, {
    style: 'currency',
    currency: businessConfig.currency.code,
    maximumFractionDigits: 0,
  }).format(n);

export function computePulse(
  data: {
    jobs: Job[];
    quotes: Quote[];
    invoices: Invoice[];
    leads: Lead[];
    transactions: Transaction[];
  },
  now: Date = new Date(),
): PulseSignal[] {
  const nowMs = now.getTime();
  const k = computeKpis(data, now);
  const signals: PulseSignal[] = [];

  // Revenue pace vs last month (same day-of-month window).
  if (k.invoicedPrevPace > 0) {
    const ratio = k.invoicedMtd / k.invoicedPrevPace;
    const pct = Math.round(Math.abs(ratio - 1) * 100);
    signals.push({
      key: 'revenue',
      label: 'Revenue',
      health: ratio >= 0.95 ? 'healthy' : ratio >= 0.7 ? 'watch' : 'attention',
      detail:
        ratio >= 1
          ? `Invoiced ${money(k.invoicedMtd)} MTD — ${pct}% ahead of last month's pace.`
          : `Invoiced ${money(k.invoicedMtd)} MTD — ${pct}% behind last month's pace.`,
    });
  } else {
    signals.push({
      key: 'revenue',
      label: 'Revenue',
      health: 'healthy',
      detail: `Invoiced ${money(k.invoicedMtd)} MTD (no prior-month baseline yet).`,
    });
  }

  // Pipeline: how much open-quote value has gone stale (>7 days, no answer).
  const staleQuotes = data.quotes.filter((q) => q.status === 'awaiting_response' && ageDays(q.issuedAt, nowMs) > 7);
  const staleValue = staleQuotes.reduce((s, q) => s + q.amount, 0);
  signals.push({
    key: 'pipeline',
    label: 'Pipeline',
    health: staleValue === 0 ? 'healthy' : staleValue >= k.pipelineValue * 0.5 ? 'attention' : 'watch',
    detail:
      staleValue === 0
        ? `${money(k.pipelineValue)} open across ${k.pipelineCount} quote${k.pipelineCount === 1 ? '' : 's'} — all fresh.`
        : `${money(staleValue)} in quotes open more than 7 days without an answer.`,
  });

  // Collections.
  signals.push({
    key: 'collections',
    label: 'Collections',
    health: k.arOverdue === 0 ? 'healthy' : k.arOverdue > 5000 || k.arOverdue > k.arOutstanding * 0.25 ? 'attention' : 'watch',
    detail:
      k.arOverdue === 0
        ? `${money(k.arOutstanding)} outstanding, nothing overdue.`
        : `${k.arOverdueCount} invoice${k.arOverdueCount === 1 ? '' : 's'} totaling ${money(k.arOverdue)} overdue.`,
  });

  // Lead flow: last 7 days vs the 7 before.
  const last7 = data.leads.filter((l) => ageDays(l.receivedAt, nowMs) < 7).length;
  const prior7 = data.leads.filter((l) => {
    const a = ageDays(l.receivedAt, nowMs);
    return a >= 7 && a < 14;
  }).length;
  let leadHealth: Health = 'healthy';
  let leadDetail = `${last7} new lead${last7 === 1 ? '' : 's'} this week.`;
  if (prior7 > 0 && last7 < prior7) {
    const drop = Math.round((1 - last7 / prior7) * 100);
    leadHealth = drop >= 50 ? 'attention' : 'watch';
    leadDetail = `Lead volume down ${drop}% vs the prior week (${last7} vs ${prior7}).`;
  } else if (last7 === 0 && prior7 === 0) {
    leadHealth = 'watch';
    leadDetail = 'No new leads in two weeks.';
  }
  signals.push({ key: 'leads', label: 'Lead Flow', health: leadHealth, detail: leadDetail });

  // Schedule: booked work over the next 7 days.
  const upcoming = data.jobs.filter((j) => {
    if (j.status !== 'scheduled' && j.status !== 'in_progress') return false;
    if (!j.scheduledAt) return j.status === 'in_progress';
    const t = new Date(j.scheduledAt).getTime();
    return t >= nowMs - DAY_MS && t <= nowMs + 7 * DAY_MS;
  });
  signals.push({
    key: 'schedule',
    label: 'Schedule',
    health: upcoming.length > 0 ? 'healthy' : 'watch',
    detail:
      upcoming.length > 0
        ? `${upcoming.length} job${upcoming.length === 1 ? '' : 's'} on the board for the next 7 days.`
        : 'Nothing scheduled in the next 7 days — open capacity.',
  });

  // Expenses pace: this month vs last (needs a real prior month to compare).
  const nowP = tzParts(now);
  const prevP = prevMonthOf(nowP);
  let spendPrevPace = 0;
  for (const t of data.transactions) {
    if (!t.date) continue;
    const p = tzParts(t.date);
    if (sameMonth(p, prevP) && p.d <= nowP.d) spendPrevPace += Math.abs(t.amount);
  }
  if (spendPrevPace > 0) {
    const ratio = k.spendMtd / spendPrevPace;
    const pct = Math.round(Math.abs(ratio - 1) * 100);
    signals.push({
      key: 'expenses',
      label: 'Expenses',
      health: ratio <= 1.15 ? 'healthy' : ratio <= 1.5 ? 'watch' : 'attention',
      detail:
        ratio > 1
          ? `${money(k.spendMtd)} spent MTD — ${pct}% above last month's pace.`
          : `${money(k.spendMtd)} spent MTD — ${pct}% below last month's pace.`,
    });
  } else {
    signals.push({
      key: 'expenses',
      label: 'Expenses',
      health: 'healthy',
      detail: `${money(k.spendMtd)} spent MTD.`,
    });
  }

  return signals;
}

// ── Attention Center ─────────────────────────────────────────────────────────

export interface AttentionItem {
  id: string;
  severity: 'high' | 'medium';
  title: string;
  detail: string;
  href: string;
  linkLabel: string;
  /** Dollar stake, for ordering. */
  value: number;
}

export function computeAttention(
  data: {
    jobs: Job[];
    quotes: Quote[];
    invoices: Invoice[];
    leads: Lead[];
    todos: MaterialTodo[];
  },
  now: Date = new Date(),
): AttentionItem[] {
  const nowMs = now.getTime();
  const items: AttentionItem[] = [];

  for (const inv of data.invoices) {
    if (!isOverdue(inv, nowMs)) continue;
    const bal = invoiceBalance(inv);
    const days = inv.dueAt ? ageDays(inv.dueAt, nowMs) : null;
    items.push({
      id: `inv-${inv.id}`,
      severity: 'high',
      title: `Invoice ${inv.number || '—'} · ${money(bal)} overdue`,
      detail: `${inv.clientName}${days != null && days > 0 ? ` — due ${days} day${days === 1 ? '' : 's'} ago` : ''}.`,
      href: '/quotes',
      linkLabel: 'View invoices',
      value: bal,
    });
  }

  for (const q of data.quotes) {
    if (q.status !== 'awaiting_response') continue;
    const days = ageDays(q.issuedAt, nowMs);
    if (days <= 7) continue;
    items.push({
      id: `quote-${q.id}`,
      severity: q.amount >= 10_000 ? 'high' : 'medium',
      title: `Quote ${q.number || '—'} · ${money(q.amount)}`,
      detail: `${q.clientName} — no response for ${days} days. Worth a follow-up call.`,
      href: '/quotes',
      linkLabel: 'View quotes',
      value: q.amount,
    });
  }

  for (const lead of data.leads) {
    if (lead.status !== 'new') continue;
    const days = ageDays(lead.receivedAt, nowMs);
    if (days < 3) continue;
    items.push({
      id: `lead-${lead.id}`,
      severity: days >= 7 ? 'high' : 'medium',
      title: `Lead: ${lead.clientName}`,
      detail: `Waiting ${days} days for first contact.`,
      href: '/leads',
      linkLabel: 'View leads',
      value: 0,
    });
  }

  for (const job of data.jobs) {
    if (job.status !== 'scheduled' || !job.scheduledAt) continue;
    const t = new Date(job.scheduledAt).getTime();
    if (!Number.isFinite(t)) continue;
    const hoursOut = (t - nowMs) / 3_600_000;
    if (hoursOut < 0 || hoursOut > 72) continue;
    const days = Math.ceil(hoursOut / 24);
    items.push({
      id: `job-${job.id}`,
      severity: 'medium',
      title: `${job.title} starts ${days <= 1 ? 'tomorrow' : `in ${days} days`}`,
      detail: `${job.clientName} · ${money(job.value)} — confirm crew, materials, and access.`,
      href: `/jobs/${job.id}`,
      linkLabel: 'View job',
      value: job.value,
    });
  }

  for (const todo of data.todos) {
    if (todo.status === 'received' || !todo.neededBy) continue;
    const days = ageDays(todo.neededBy, nowMs);
    if (days <= 0) continue;
    items.push({
      id: `todo-${todo.id}`,
      severity: 'high',
      title: `${todo.kind === 'equipment' ? 'Equipment' : 'Material'} overdue: ${todo.item}`,
      detail: `Needed ${days} day${days === 1 ? '' : 's'} ago and still ${todo.status === 'ordered' ? 'not received' : 'not ordered'}.`,
      href: '/materials',
      linkLabel: 'View materials',
      value: 0,
    });
  }

  // High severity first, then the biggest dollars.
  return items.sort((a, b) =>
    a.severity !== b.severity ? (a.severity === 'high' ? -1 : 1) : b.value - a.value,
  );
}
