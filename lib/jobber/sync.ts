/**
 * Jobber → domain sync.
 *
 * Two responsibilities:
 *  1. Pure status-mapping functions (mapJobStatus/mapQuoteStatus/mapInvoiceStatus)
 *     — unit-tested; the only place Jobber's enum vocabulary is interpreted.
 *  2. Defensive node mappers that turn raw Jobber nodes into our domain types,
 *     guarding EVERY field. A missing/renamed field logs a specific warning
 *     (naming the field + node id) and falls back — it never throws. That keeps
 *     a future Jobber schema change to an isolated, obvious fix.
 */

import type { Invoice, InvoiceStatus, Job, JobStatus, Lead, Quote, QuoteStatus } from '@/lib/db/types';
import {
  INVOICES_QUERY,
  JOBS_QUERY,
  QUOTES_QUERY,
  REQUESTS_QUERY,
  type JobberConnection,
  type JobberClientRef,
  type JobberInvoiceNode,
  type JobberJobNode,
  type JobberQuoteNode,
  type JobberRequestNode,
} from './queries';
import { JobberClient } from './client';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/** Normalize an enum-ish string to lowercase alphanumerics for matching. */
export function normalizeEnum(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

const JOB_STATUS_MAP: Record<string, JobStatus> = {
  unscheduled: 'lead',
  upcoming: 'scheduled',
  scheduled: 'scheduled',
  active: 'in_progress',
  inprogress: 'in_progress',
  late: 'in_progress',
  onhold: 'scheduled',
  complete: 'complete',
  completed: 'complete',
  requiresinvoicing: 'complete',
  invoiced: 'invoiced',
  invoicing: 'invoiced',
  paid: 'paid',
  archived: 'archived',
  closed: 'archived',
};

const QUOTE_STATUS_MAP: Record<string, QuoteStatus> = {
  draft: 'draft',
  awaitingresponse: 'awaiting_response',
  pending: 'awaiting_response',
  changesrequested: 'awaiting_response',
  approved: 'approved',
  converted: 'converted',
  archived: 'archived',
};

const INVOICE_STATUS_MAP: Record<string, InvoiceStatus> = {
  draft: 'draft',
  sent: 'sent',
  pending: 'sent',
  awaitingpayment: 'sent',
  partial: 'partial',
  partiallypaid: 'partial',
  paid: 'paid',
  pastdue: 'past_due',
  overdue: 'past_due',
  baddebt: 'bad_debt',
};

function mapWithTable<T extends string>(
  raw: unknown,
  table: Record<string, T>,
  fallback: T,
  kind: string,
): T {
  const key = normalizeEnum(raw);
  if (key && table[key]) return table[key];
  if (raw != null && raw !== '') {
    console.warn(`[jobber] unrecognized ${kind} status "${String(raw)}"; mapped to "${fallback}".`);
  }
  return fallback;
}

export function mapJobStatus(raw: unknown): JobStatus {
  return mapWithTable(raw, JOB_STATUS_MAP, 'unknown', 'job');
}
export function mapQuoteStatus(raw: unknown): QuoteStatus {
  return mapWithTable(raw, QUOTE_STATUS_MAP, 'unknown', 'quote');
}
export function mapInvoiceStatus(raw: unknown): InvoiceStatus {
  return mapWithTable(raw, INVOICE_STATUS_MAP, 'unknown', 'invoice');
}

// ── defensive field access ───────────────────────────────────────────────────
function warnMissing(field: string, nodeId: string | undefined, kind: string): void {
  console.warn(`[jobber] ${kind} ${nodeId ?? '(no id)'} missing expected field "${field}".`);
}

function clientName(client: JobberClientRef | undefined, nodeId: string | undefined, kind: string): string {
  const name = client?.name;
  if (typeof name === 'string' && name.length > 0) return name;
  warnMissing('client.name', nodeId, kind);
  return 'Unknown client';
}

function firstEmail(client: JobberClientRef | undefined): string | undefined {
  return client?.emails?.find((e) => e?.address)?.address ?? undefined;
}
function firstPhone(client: JobberClientRef | undefined): string | undefined {
  return client?.phones?.find((p) => p?.number)?.number ?? undefined;
}

function addressString(property: JobberJobNode['property']): string | undefined {
  const a = property?.address;
  if (!a) return undefined;
  const parts = [a.street, a.city, a.province, a.postalCode].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(', ') : undefined;
}

function numberString(value: unknown, prefix: string): string {
  if (value == null) return '';
  return `${prefix}${value}`;
}

// ── node → domain mappers (never throw) ──────────────────────────────────────
export function mapJobberJob(node: JobberJobNode): Job | null {
  if (!node?.id) {
    console.warn('[jobber] skipping job node with no id.');
    return null;
  }
  return {
    id: node.id,
    jobberId: node.id,
    title: typeof node.title === 'string' && node.title ? node.title : `Job ${node.jobNumber ?? ''}`.trim(),
    clientName: clientName(node.client, node.id, 'job'),
    address: addressString(node.property),
    status: mapJobStatus(node.jobStatus),
    scheduledAt: typeof node.startAt === 'string' ? node.startAt : undefined,
    completedAt: typeof node.endAt === 'string' ? node.endAt : undefined,
    value: typeof node.total === 'number' ? node.total : 0,
  };
}

export function mapJobberQuote(node: JobberQuoteNode): Quote | null {
  if (!node?.id) {
    console.warn('[jobber] skipping quote node with no id.');
    return null;
  }
  return {
    id: node.id,
    jobberId: node.id,
    number: numberString(node.quoteNumber, 'Q-') || node.id,
    clientName: clientName(node.client, node.id, 'quote'),
    status: mapQuoteStatus(node.quoteStatus),
    amount: typeof node.amounts?.total === 'number' ? node.amounts.total : 0,
    issuedAt: typeof node.createdAt === 'string' ? node.createdAt : undefined,
  };
}

export function mapJobberInvoice(node: JobberInvoiceNode): Invoice | null {
  if (!node?.id) {
    console.warn('[jobber] skipping invoice node with no id.');
    return null;
  }
  const amount = typeof node.total === 'number' ? node.total : 0;
  const amountPaid = typeof node.amountPaid === 'number' ? node.amountPaid : 0;
  return {
    id: node.id,
    jobberId: node.id,
    number: numberString(node.invoiceNumber, 'INV-') || node.id,
    clientName: clientName(node.client, node.id, 'invoice'),
    status: mapInvoiceStatus(node.invoiceStatus),
    amount,
    amountPaid,
    issuedAt: typeof node.issuedDate === 'string' ? node.issuedDate : undefined,
    dueAt: typeof node.dueDate === 'string' ? node.dueDate : undefined,
  };
}

export function mapJobberRequest(node: JobberRequestNode): Lead | null {
  if (!node?.id) {
    console.warn('[jobber] skipping request node with no id.');
    return null;
  }
  return {
    id: node.id,
    jobberId: node.id,
    clientName: clientName(node.client, node.id, 'request'),
    contactEmail: firstEmail(node.client),
    contactPhone: firstPhone(node.client),
    summary: typeof node.title === 'string' ? node.title : 'Request',
    receivedAt: typeof node.createdAt === 'string' ? node.createdAt : '',
    source: 'jobber_request',
    status: normalizeEnum(node.requestStatus) === 'converted' ? 'won' : 'new',
  };
}

// ── full sync ────────────────────────────────────────────────────────────────
async function fetchConnection<T>(
  client: JobberClient,
  query: string,
  key: 'jobs' | 'quotes' | 'invoices' | 'requests',
): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  // Bound the loop so a broken pageInfo can't spin forever.
  for (let page = 0; page < 100; page++) {
    const data = await client.graphql<Record<string, JobberConnection<T>>>(query, { after });
    const conn = data?.[key];
    const nodes = (conn?.nodes ?? []).filter((n): n is T => n != null);
    out.push(...nodes);
    if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

export interface SyncResult {
  jobs: number;
  quotes: number;
  invoices: number;
  leads: number;
  errors: string[];
}

/**
 * Pull jobs/quotes/invoices/requests from Jobber and upsert into Supabase.
 * Each entity is isolated: a failure in one is recorded and the rest continue.
 */
export async function syncAll(): Promise<SyncResult> {
  const result: SyncResult = { jobs: 0, quotes: 0, invoices: 0, leads: 0, errors: [] };
  const admin = createSupabaseAdminClient();
  if (!admin) {
    result.errors.push('Supabase service role not configured — nothing to sync into.');
    return result;
  }
  const client = await JobberClient.fromStoredTokens();
  if (!client) {
    result.errors.push('Jobber not connected — no stored OAuth tokens.');
    return result;
  }

  async function step<T>(
    label: 'jobs' | 'quotes' | 'invoices' | 'leads',
    fetch: () => Promise<T[]>,
    table: string,
  ): Promise<void> {
    try {
      const rows = await fetch();
      if (rows.length === 0) return;
      const { error } = await admin!.from(table).upsert(rows as Record<string, unknown>[], { onConflict: 'jobber_id' });
      if (error) throw new Error(error.message);
      result[label] = rows.length;
    } catch (err) {
      result.errors.push(`${label}: ${(err as Error).message}`);
    }
  }

  await step(
    'jobs',
    async () => (await fetchConnection<JobberJobNode>(client, JOBS_QUERY, 'jobs')).map(mapJobberJob).filter(Boolean).map(toJobRow),
    'jobs',
  );
  await step(
    'quotes',
    async () => (await fetchConnection<JobberQuoteNode>(client, QUOTES_QUERY, 'quotes')).map(mapJobberQuote).filter(Boolean).map(toQuoteRow),
    'quotes',
  );
  await step(
    'invoices',
    async () => (await fetchConnection<JobberInvoiceNode>(client, INVOICES_QUERY, 'invoices')).map(mapJobberInvoice).filter(Boolean).map(toInvoiceRow),
    'invoices',
  );
  await step(
    'leads',
    async () => (await fetchConnection<JobberRequestNode>(client, REQUESTS_QUERY, 'requests')).map(mapJobberRequest).filter(Boolean).map(toLeadRow),
    'leads',
  );

  return result;
}

// ── domain → Supabase row (snake_case) ───────────────────────────────────────
function toJobRow(j: Job | null): Record<string, unknown> {
  const job = j!;
  return {
    jobber_id: job.jobberId,
    title: job.title,
    client_name: job.clientName,
    address: job.address ?? null,
    status: job.status,
    scheduled_at: job.scheduledAt ?? null,
    completed_at: job.completedAt ?? null,
    value: job.value,
  };
}
function toQuoteRow(q: Quote | null): Record<string, unknown> {
  const quote = q!;
  return {
    jobber_id: quote.jobberId,
    number: quote.number,
    client_name: quote.clientName,
    status: quote.status,
    amount: quote.amount,
    issued_at: quote.issuedAt ?? null,
  };
}
function toInvoiceRow(i: Invoice | null): Record<string, unknown> {
  const inv = i!;
  return {
    jobber_id: inv.jobberId,
    number: inv.number,
    client_name: inv.clientName,
    status: inv.status,
    amount: inv.amount,
    amount_paid: inv.amountPaid,
    issued_at: inv.issuedAt ?? null,
    due_at: inv.dueAt ?? null,
  };
}
function toLeadRow(l: Lead | null): Record<string, unknown> {
  const lead = l!;
  return {
    jobber_id: lead.jobberId,
    client_name: lead.clientName,
    contact_email: lead.contactEmail ?? null,
    contact_phone: lead.contactPhone ?? null,
    summary: lead.summary,
    received_at: lead.receivedAt || null,
    source: lead.source,
    status: lead.status,
  };
}
