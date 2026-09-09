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
import type {
  AttentionStateRecord,
  Invoice,
  Job,
  Lead,
  MaterialTodo,
  Quote,
  QuoteReviewRecord,
  Transaction,
} from '@/lib/db/types';

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
  /** RAW open pipeline — exactly what Jobber reports. Never silently adjusted. */
  pipelineValue: number;
  pipelineCount: number;
  /**
   * Adjusted pipeline: raw minus quotes internally classified likely_dead /
   * known_lost. Source truth (Jobber) is preserved in pipelineValue.
   */
  adjustedPipeline: number;
  adjustedCount: number;
  /** Open value awaiting internal review (no classification yet). */
  unreviewedPipeline: number;
  unreviewedCount: number;
  /** Open value classified follow_up — the owner intends to chase these. */
  followUpPipeline: number;
  followUpCount: number;
  /** Open value classified likely_dead (internal judgment, source untouched). */
  likelyDeadPipeline: number;
  likelyDeadCount: number;
  /** Open value classified known_lost (internal judgment, source untouched). */
  knownLostPipeline: number;
  knownLostCount: number;
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
    /** Internal pipeline-review classifications, keyed by quote id. */
    quoteReviews?: Map<string, QuoteReviewRecord>;
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

  const reviews = data.quoteReviews ?? new Map<string, QuoteReviewRecord>();
  const DEAD = new Set(['likely_dead', 'known_lost']);
  const aliveQuotes = openQuotes.filter((q) => !DEAD.has(reviews.get(q.id)?.classification ?? ''));
  const adjustedPipeline = aliveQuotes.reduce((s, q) => s + q.amount, 0);
  const sumWhere = (pred: (q: Quote) => boolean) =>
    openQuotes.filter(pred).reduce((acc, q) => ({ v: acc.v + q.amount, n: acc.n + 1 }), { v: 0, n: 0 });
  const unreviewed = sumWhere((q) => !reviews.has(q.id));
  const followUp = sumWhere((q) => reviews.get(q.id)?.classification === 'follow_up');
  const likelyDead = sumWhere((q) => reviews.get(q.id)?.classification === 'likely_dead');
  const knownLost = sumWhere((q) => reviews.get(q.id)?.classification === 'known_lost');
  const unreviewedPipeline = unreviewed.v;

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
    adjustedPipeline,
    adjustedCount: aliveQuotes.length,
    unreviewedPipeline,
    unreviewedCount: unreviewed.n,
    followUpPipeline: followUp.v,
    followUpCount: followUp.n,
    likelyDeadPipeline: likelyDead.v,
    likelyDeadCount: likelyDead.n,
    knownLostPipeline: knownLost.v,
    knownLostCount: knownLost.n,
    // Weighted on the ADJUSTED number — dead deals shouldn't inflate planning.
    weightedPipeline: adjustedPipeline * PIPELINE_WEIGHT,
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
  /** Seen-but-not-fixed: stays visible, rendered muted. */
  acknowledged?: boolean;
  /** Prefill for one-click "create follow-up task". */
  followUp?: { title: string; entityType: 'job' | 'quote' | 'invoice' | 'lead'; entityId: string };
}

export function computeAttention(
  data: {
    jobs: Job[];
    quotes: Quote[];
    invoices: Invoice[];
    leads: Lead[];
    todos: MaterialTodo[];
    /** Internal ack/snooze/resolve states, keyed by item id. */
    attentionStates?: Map<string, AttentionStateRecord>;
    /** Latest recorded Jobber sync run, for the missed-sync alert. */
    jobberSync?: { ranAt: string; ok: boolean } | null;
  },
  now: Date = new Date(),
): AttentionItem[] {
  const nowMs = now.getTime();
  const items: AttentionItem[] = [];

  // Missed/failed sync — the OS must say when its own inputs are stale.
  // (Only when a sync log exists: before the first recorded run there is
  // nothing trustworthy to alarm on, and the Systems indicator still covers
  // the legacy heuristic.)
  if (data.jobberSync) {
    const ranMs = new Date(data.jobberSync.ranAt).getTime();
    const hoursAgo = Math.floor((nowMs - ranMs) / 3_600_000);
    if (!data.jobberSync.ok) {
      items.push({
        id: 'sync-jobber',
        severity: 'high',
        title: 'Jobber sync FAILED on its last run',
        detail: `The last attempt ${hoursAgo}h ago recorded errors — numbers below may be stale. Check Settings → Sync.`,
        href: '/settings',
        linkLabel: 'Open settings',
        value: 0,
      });
    } else if (Number.isFinite(ranMs) && nowMs - ranMs > 36 * 3_600_000) {
      items.push({
        id: 'sync-jobber',
        severity: 'high',
        title: 'Jobber sync overdue',
        detail: `No sync recorded for ${Math.floor(hoursAgo / 24)}+ days (expected daily). Job/quote/invoice numbers may be stale.`,
        href: '/settings',
        linkLabel: 'Open settings',
        value: 0,
      });
    }
  }

  for (const inv of data.invoices) {
    if (!isOverdue(inv, nowMs)) continue;
    const bal = invoiceBalance(inv);
    const days = inv.dueAt ? ageDays(inv.dueAt, nowMs) : null;
    // Source inconsistency: Jobber says PAID yet reports an open balance.
    // Say exactly that instead of a generic "overdue" — the fix lives in
    // Jobber (record the missing payment, or reopen the invoice).
    const paidMismatch = inv.status === 'paid';
    items.push({
      id: `inv-${inv.id}`,
      severity: 'high',
      title: paidMismatch
        ? `Invoice ${inv.number || '—'} marked PAID in Jobber but ${money(bal)} balance remains`
        : `Invoice ${inv.number || '—'} · ${money(bal)} overdue`,
      detail: paidMismatch
        ? `${inv.clientName} — Jobber's status and its own balance disagree. Open it in Jobber: record the missing payment, or reopen the invoice.`
        : `${inv.clientName}${days != null && days > 0 ? ` — due ${days} day${days === 1 ? '' : 's'} ago` : ''}.`,
      href: inv.number ? `/quotes?q=${encodeURIComponent(inv.number)}` : '/quotes?view=overdue',
      linkLabel: 'View invoice',
      value: bal,
      followUp: {
        title: paidMismatch
          ? `Verify ${inv.number || 'invoice'} in Jobber — paid status vs ${money(bal)} balance (${inv.clientName})`
          : `Collect ${inv.number || 'invoice'} — ${money(bal)} (${inv.clientName})`,
        entityType: 'invoice',
        entityId: inv.id,
      },
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
      href: q.number ? `/quotes?q=${encodeURIComponent(q.number)}` : '/quotes?view=stale',
      linkLabel: 'View quote',
      value: q.amount,
      followUp: { title: `Follow up Quote ${q.number} — ${q.clientName}`, entityType: 'quote', entityId: q.id },
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
      href: `/leads?q=${encodeURIComponent(lead.clientName)}`,
      linkLabel: 'View lead',
      value: 0,
      followUp: { title: `Contact lead: ${lead.clientName}`, entityType: 'lead', entityId: lead.id },
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
      followUp: { title: `Pre-start check: ${job.title}`, entityType: 'job', entityId: job.id },
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

  // Apply internal states: resolved disappears, unexpired snoozes hide, and
  // acknowledged items stay visible but muted (seen ≠ fixed). Never touches
  // the underlying Jobber records.
  const states = data.attentionStates ?? new Map<string, AttentionStateRecord>();
  const visible = items.filter((item) => {
    const s = states.get(item.id);
    if (!s) return true;
    if (s.state === 'resolved') return false;
    if (s.state === 'snoozed' && s.snoozedUntil && new Date(s.snoozedUntil).getTime() > nowMs) return false;
    return true;
  });
  for (const item of visible) {
    if (states.get(item.id)?.state === 'acknowledged') item.acknowledged = true;
  }

  // High severity first, then the biggest dollars; acknowledged sink.
  return visible.sort((a, b) => {
    if (Boolean(a.acknowledged) !== Boolean(b.acknowledged)) return a.acknowledged ? 1 : -1;
    return a.severity !== b.severity ? (a.severity === 'high' ? -1 : 1) : b.value - a.value;
  });
}

// ── executive status narrative (deterministic; Claude takes over in Phase D) ─

export interface BusinessStatus {
  level: Health;
  headline: string;
  detail: string;
}

/** One honest sentence about the company's state, from the worst pulse signal. */
export function computeBusinessStatus(signals: PulseSignal[]): BusinessStatus {
  const worst =
    signals.find((s) => s.health === 'attention') ?? signals.find((s) => s.health === 'watch');
  if (!worst) {
    return { level: 'healthy', headline: 'All systems steady', detail: 'No signals need attention right now.' };
  }
  return {
    level: worst.health,
    headline: worst.health === 'attention' ? 'Attention required' : 'Worth watching',
    detail: worst.detail,
  };
}
