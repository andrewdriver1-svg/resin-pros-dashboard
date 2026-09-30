/**
 * Normalized business activity feed — one stream of meaningful business
 * events, each anchored to a real timestamp we actually have and each
 * clickable through to the record it describes.
 *
 * PURE module: buildFeed() takes already-loaded records and returns events.
 * No I/O, no dates invented. The honesty rule: an event is only emitted for a
 * timestamp the source system recorded (quote issued, job scheduled/completed,
 * lead received, invoice issued, email candidate detected). We never fabricate
 * "status changed" moments that Jobber didn't give us — current status is
 * shown as context on the event we can date, not as its own event.
 */

import type {
  ActivityEntry,
  Customer,
  Invoice,
  Job,
  Lead,
  LeadCandidate,
  Quote,
} from '@/lib/db/types';

export type FeedKind =
  | 'quote'
  | 'invoice'
  | 'job_scheduled'
  | 'job_completed'
  | 'lead'
  | 'customer'
  | 'opportunity'
  | 'internal';

export interface FeedEvent {
  /** Stable id (kind + record id [+ facet]) for React keys and dedupe. */
  id: string;
  kind: FeedKind;
  /** ISO timestamp the event actually happened (source-recorded). */
  at: string;
  /** Short headline, e.g. "Quote Q-295 sent". */
  title: string;
  /** Who/what it's about, e.g. the client name or candidate company. */
  subject?: string;
  /** Dollar amount when the event has one. */
  amount?: number;
  /** Extra context, e.g. "awaiting response" or "18,000 SF · King of Prussia, PA". */
  detail?: string;
  /** Where clicking goes. Every event is clickable. */
  href: string;
  /** Which system recorded it. */
  source: 'jobber' | 'email' | 'internal';
  tone?: 'good' | 'warn' | 'accent';
}

export interface FeedInputs {
  quotes: Quote[];
  invoices: Invoice[];
  jobs: Job[];
  leads: Lead[];
  customers: Customer[];
  candidates: LeadCandidate[];
  activity: ActivityEntry[];
  /** Map of jobberClientId → internal customer id, for entity links. */
  customerIdByJobberClientId?: Map<string, string>;
}

const QUOTE_STATUS_DETAIL: Record<string, string | undefined> = {
  draft: 'draft',
  awaiting_response: 'awaiting response',
  approved: 'approved',
  converted: 'converted to job',
  archived: 'archived',
};

const INVOICE_STATUS_DETAIL: Record<string, string | undefined> = {
  draft: 'draft',
  sent: 'sent',
  partial: 'partially paid',
  paid: 'paid',
  past_due: 'past due',
  bad_debt: 'bad debt',
};

function valid(at: string | undefined): at is string {
  return Boolean(at && !Number.isNaN(new Date(at).getTime()));
}

/** Link an event to its most specific navigable record. */
function customerHref(jobberClientId: string | undefined, map: Map<string, string> | undefined, fallback: string): string {
  if (jobberClientId && map?.has(jobberClientId)) return `/customers/${map.get(jobberClientId)}`;
  return fallback;
}

export function buildFeed(inputs: FeedInputs, limit = 40): FeedEvent[] {
  const events: FeedEvent[] = [];
  const map = inputs.customerIdByJobberClientId;

  for (const q of inputs.quotes) {
    if (!valid(q.issuedAt)) continue;
    events.push({
      id: `quote:${q.id}`,
      kind: 'quote',
      at: q.issuedAt,
      title: `Quote ${q.number} sent`,
      subject: q.clientName,
      amount: q.amount,
      detail: QUOTE_STATUS_DETAIL[q.status],
      href: q.jobId ? `/jobs/${q.jobId}` : customerHref(q.jobberClientId, map, '/quotes'),
      source: 'jobber',
      tone: q.status === 'approved' || q.status === 'converted' ? 'good' : undefined,
    });
  }

  for (const inv of inputs.invoices) {
    if (!valid(inv.issuedAt)) continue;
    events.push({
      id: `invoice:${inv.id}`,
      kind: 'invoice',
      at: inv.issuedAt,
      title: `Invoice ${inv.number} issued`,
      subject: inv.clientName,
      amount: inv.amount,
      detail: INVOICE_STATUS_DETAIL[inv.status],
      href: inv.jobId ? `/jobs/${inv.jobId}` : customerHref(inv.jobberClientId, map, '/company'),
      source: 'jobber',
      tone: inv.status === 'paid' ? 'good' : inv.status === 'past_due' ? 'warn' : undefined,
    });
  }

  for (const j of inputs.jobs) {
    if (valid(j.scheduledAt)) {
      events.push({
        id: `job:${j.id}:scheduled`,
        kind: 'job_scheduled',
        at: j.scheduledAt,
        title: `Job scheduled — ${j.title || j.clientName}`,
        subject: j.clientName,
        amount: j.value > 0 ? j.value : undefined,
        href: `/jobs/${j.id}`,
        source: 'jobber',
      });
    }
    if (valid(j.completedAt)) {
      events.push({
        id: `job:${j.id}:completed`,
        kind: 'job_completed',
        at: j.completedAt,
        title: `Job completed — ${j.title || j.clientName}`,
        subject: j.clientName,
        amount: j.value > 0 ? j.value : undefined,
        href: `/jobs/${j.id}`,
        source: 'jobber',
        tone: 'good',
      });
    }
  }

  for (const l of inputs.leads) {
    if (!valid(l.receivedAt)) continue;
    events.push({
      id: `lead:${l.id}`,
      kind: 'lead',
      at: l.receivedAt,
      title: `New lead — ${l.clientName}`,
      subject: l.clientName,
      detail: l.summary ? truncate(l.summary, 90) : undefined,
      href: '/leads',
      source: 'jobber',
      tone: 'accent',
    });
  }

  for (const c of inputs.customers) {
    if (!valid(c.createdAt)) continue;
    events.push({
      id: `customer:${c.id}`,
      kind: 'customer',
      at: c.createdAt,
      title: `New customer — ${c.name}`,
      subject: c.name,
      href: `/customers/${c.id}`,
      source: 'jobber',
    });
  }

  for (const cand of inputs.candidates) {
    if (!valid(cand.createdAt)) continue;
    const bits = [cand.estimatedScope, cand.location].filter(Boolean).join(' · ');
    events.push({
      id: `candidate:${cand.id}`,
      kind: 'opportunity',
      at: cand.createdAt,
      title: `Opportunity detected — ${cand.company || cand.contactName || 'unknown sender'}`,
      subject: cand.company || cand.contactName,
      detail: bits || truncate(cand.summary, 90),
      href: '/opportunities',
      source: cand.source === 'email' ? 'email' : 'internal',
      tone: 'accent',
    });
  }

  for (const a of inputs.activity) {
    if (!valid(a.createdAt)) continue;
    events.push({
      id: `activity:${a.id}`,
      kind: 'internal',
      at: a.createdAt,
      title: a.summary,
      detail: a.actor === 'human' ? undefined : a.actor,
      href: activityHref(a),
      source: 'internal',
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return dedupe(events).slice(0, limit);
}

/** Internal log rows link to the page that owns the entity they touched. */
function activityHref(a: ActivityEntry): string {
  switch (a.entityType) {
    case 'job':
      return a.entityId ? `/jobs/${a.entityId}` : '/jobs';
    case 'customer':
      return a.entityId ? `/customers/${a.entityId}` : '/customers';
    case 'task':
      return '/todo';
    case 'material':
      return '/materials';
    case 'lead_candidate':
    case 'email_thread':
      return '/opportunities';
    case 'quote':
      return '/quotes';
    case 'invoice':
      return '/company';
    default:
      return '/company';
  }
}

/**
 * The internal log records owner actions that sometimes mirror a source event
 * (e.g. "Synced 3 quotes"). Events keep their own ids, so duplicates here are
 * only identical ids (defensive) — semantic overlap is left visible because
 * the two lines say different true things.
 */
function dedupe(events: FeedEvent[]): FeedEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

/** Group events by business day (America/New_York) for rendering. */
export function groupFeedByDay(events: FeedEvent[], timeZone: string): { day: string; events: FeedEvent[] }[] {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' });
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const groups: { key: string; day: string; events: FeedEvent[] }[] = [];
  for (const e of events) {
    const d = new Date(e.at);
    const key = keyFmt.format(d);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({ key, day: fmt.format(d), events: [e] });
  }
  return groups.map(({ day, events: ev }) => ({ day, events: ev }));
}
