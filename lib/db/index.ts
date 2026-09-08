/**
 * Data layer. Every dashboard read goes through here.
 *
 * Pattern: if Supabase is configured, read from it; on ANY error (misconfig,
 * missing table, network) log a specific warning and fall back to fixtures so
 * the dashboard never hard-crashes on a data read. If Supabase isn't configured
 * at all, fixtures are the intended source and no warning is logged.
 *
 * Row mappers are defensive: they coerce/guard every column so a schema drift
 * degrades a single field rather than throwing.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import {
  fixtureActivity,
  fixtureCalendarEvents,
  fixtureGoogleBusiness,
  fixtureInvoices,
  fixtureJobCosts,
  fixtureJobs,
  fixtureLeads,
  fixtureMarketing,
  fixtureNotes,
  fixtureQuotes,
  fixtureTasks,
  fixtureTodos,
  fixtureTransactions,
} from './fixtures';
import type { Task } from '@/lib/tasks';
import type { CalendarEvent } from '@/lib/calendar';
import type {
  ActivityEntry,
  AttentionStateRecord,
  GoogleBusinessSnapshot,
  Invoice,
  Job,
  JobCost,
  JobDetail,
  Lead,
  MarketingEntry,
  MaterialTodo,
  NoteRecord,
  Quote,
  QuoteReviewRecord,
  Transaction,
} from './types';

// ── small coercion helpers ───────────────────────────────────────────────────
type Row = Record<string, unknown>;
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v));
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);

/**
 * Generic list read with fixture fallback. `table` + `map` describe the Supabase
 * source; `fixture` is the fallback. Any failure returns the fixture.
 */
/**
 * PostgREST silently truncates unlimited selects at its `db-max-rows` cap
 * (1000 by default) — a truncated 200, not an error. Ask for more explicitly
 * so a year of transactions doesn't quietly start dropping its oldest rows
 * from every total. 10k is far above current volume; revisit with pagination
 * if any table approaches it.
 */
const MAX_ROWS = 10_000;

/**
 * DATA TRUST (Phase C): in production (Supabase configured), a failed read
 * NEVER falls back to fixtures — sample data must never masquerade as company
 * data. Failures return an empty list and are recorded so the shell can show a
 * degraded-data state. Fixtures serve only dev/e2e (Supabase not configured).
 */
interface TableHealth {
  ok: boolean;
  at: number;
  error?: string;
}
const tableHealth = new Map<string, TableHealth>();

function recordHealth(table: string, ok: boolean, error?: string) {
  tableHealth.set(table, { ok, at: Date.now(), error });
  if (!ok) console.error(`[db] ${table} read FAILED (${error}); serving empty, not fixtures.`);
}

/** Per-instance view of recent read failures, for the Systems indicator. */
export function getTableHealth(): { table: string; ok: boolean; at: number; error?: string }[] {
  return Array.from(tableHealth.entries()).map(([table, h]) => ({ table, ...h }));
}

/** Cheap connectivity probe: can we reach the database at all right now? */
export async function probeDatabase(): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: true }; // fixture/dev mode — nothing to probe
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from('businesses').select('id').limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function readList<T>(opts: {
  table: string;
  map: (row: Row) => T;
  fixture: T[];
  order?: { column: string; ascending: boolean };
}): Promise<T[]> {
  if (!isSupabaseConfigured()) return opts.fixture;
  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase.from(opts.table).select('*').limit(MAX_ROWS);
    if (opts.order) query = query.order(opts.order.column, { ascending: opts.order.ascending });
    const { data, error } = await query;
    if (error) {
      recordHealth(opts.table, false, error.message);
      return [];
    }
    if (!Array.isArray(data)) {
      recordHealth(opts.table, false, 'non-array response');
      return [];
    }
    recordHealth(opts.table, true);
    return data.map((r) => opts.map(r as Row));
  } catch (err) {
    recordHealth(opts.table, false, (err as Error).message);
    return [];
  }
}

// ── row mappers ──────────────────────────────────────────────────────────────
function rowToJob(r: Row): Job {
  return {
    id: str(r.id),
    jobberId: optStr(r.jobber_id),
    title: str(r.title, 'Untitled job'),
    clientName: str(r.client_name, 'Unknown client'),
    address: optStr(r.address),
    status: str(r.status, 'unknown') as Job['status'],
    scheduledAt: optStr(r.scheduled_at),
    completedAt: optStr(r.completed_at),
    value: num(r.value),
    notes: optStr(r.notes),
  };
}

function rowToQuote(r: Row): Quote {
  return {
    id: str(r.id),
    jobberId: optStr(r.jobber_id),
    jobId: optStr(r.job_id),
    number: str(r.number),
    clientName: str(r.client_name, 'Unknown client'),
    status: str(r.status, 'unknown') as Quote['status'],
    amount: num(r.amount),
    issuedAt: optStr(r.issued_at),
  };
}

function rowToInvoice(r: Row): Invoice {
  return {
    id: str(r.id),
    jobberId: optStr(r.jobber_id),
    jobId: optStr(r.job_id),
    number: str(r.number),
    clientName: str(r.client_name, 'Unknown client'),
    status: str(r.status, 'unknown') as Invoice['status'],
    amount: num(r.amount),
    amountPaid: num(r.amount_paid),
    issuedAt: optStr(r.issued_at),
    dueAt: optStr(r.due_at),
  };
}

function rowToJobCost(r: Row): JobCost {
  return {
    id: str(r.id),
    jobId: str(r.job_id),
    categoryId: str(r.category_id, 'uncategorized'),
    description: str(r.description),
    amount: num(r.amount),
    date: str(r.date),
    accountId: optStr(r.account_id),
    source: str(r.source, 'manual'),
  };
}

function rowToTodo(r: Row): MaterialTodo {
  return {
    id: str(r.id),
    jobId: optStr(r.job_id),
    kind: (str(r.kind, 'material') as MaterialTodo['kind']) === 'equipment' ? 'equipment' : 'material',
    item: str(r.item),
    quantity: optStr(r.quantity),
    status: str(r.status, 'needed') as MaterialTodo['status'],
    neededBy: optStr(r.needed_by),
    notes: optStr(r.notes),
  };
}

function rowToLead(r: Row): Lead {
  return {
    id: str(r.id),
    jobberId: optStr(r.jobber_id),
    clientName: str(r.client_name, 'Unknown'),
    contactEmail: optStr(r.contact_email),
    contactPhone: optStr(r.contact_phone),
    summary: str(r.summary),
    receivedAt: str(r.received_at),
    source: str(r.source, 'unknown'),
    status: str(r.status, 'new') as Lead['status'],
    jobId: optStr(r.job_id),
  };
}

function rowToMarketing(r: Row): MarketingEntry {
  return {
    id: str(r.id),
    channel: str(r.channel),
    period: str(r.period),
    spend: num(r.spend),
    leads: num(r.leads),
    wonJobs: num(r.won_jobs),
    notes: optStr(r.notes),
  };
}

function rowToTransaction(r: Row): Transaction {
  return {
    id: str(r.id),
    date: str(r.date),
    description: str(r.description),
    amount: num(r.amount),
    categoryId: str(r.category_id, 'uncategorized'),
    accountId: optStr(r.account_id),
    jobId: optStr(r.job_id),
    source: str(r.source, 'manual'),
  };
}

// ── public reads ─────────────────────────────────────────────────────────────
export function getJobs(): Promise<Job[]> {
  return readList({ table: 'jobs', map: rowToJob, fixture: fixtureJobs, order: { column: 'scheduled_at', ascending: false } });
}

export function getLeads(): Promise<Lead[]> {
  return readList({ table: 'leads', map: rowToLead, fixture: fixtureLeads, order: { column: 'received_at', ascending: false } });
}

// Explicit sort orders below: without one, Postgres returns heap order, which
// shifts as rows are updated — tables would reshuffle between page loads.
export function getQuotes(): Promise<Quote[]> {
  return readList({ table: 'quotes', map: rowToQuote, fixture: fixtureQuotes, order: { column: 'issued_at', ascending: false } });
}

export function getInvoices(): Promise<Invoice[]> {
  // Oldest unpaid first is the AR question; issued_at ascending approximates
  // aging until the UI grows real sorting.
  return readList({ table: 'invoices', map: rowToInvoice, fixture: fixtureInvoices, order: { column: 'issued_at', ascending: true } });
}

export function getJobCosts(): Promise<JobCost[]> {
  return readList({ table: 'job_costs', map: rowToJobCost, fixture: fixtureJobCosts, order: { column: 'date', ascending: false } });
}

export function getTodos(): Promise<MaterialTodo[]> {
  return readList({ table: 'material_todos', map: rowToTodo, fixture: fixtureTodos, order: { column: 'needed_by', ascending: true } });
}

export function getMarketing(): Promise<MarketingEntry[]> {
  return readList({ table: 'marketing_entries', map: rowToMarketing, fixture: fixtureMarketing, order: { column: 'period', ascending: false } });
}

export function getTransactions(): Promise<Transaction[]> {
  return readList({ table: 'transactions', map: rowToTransaction, fixture: fixtureTransactions, order: { column: 'date', ascending: false } });
}

/** Assemble a single job with all linked records, for the detail page. */
export async function getJob(id: string): Promise<JobDetail | null> {
  const [jobs, quotes, invoices, costs, todos] = await Promise.all([
    getJobs(),
    getQuotes(),
    getInvoices(),
    getJobCosts(),
    getTodos(),
  ]);
  const job = jobs.find((j) => j.id === id);
  if (!job) return null;
  return {
    ...job,
    quotes: quotes.filter((q) => q.jobId === id),
    invoices: invoices.filter((i) => i.jobId === id),
    costs: costs.filter((c) => c.jobId === id),
    todos: todos.filter((t) => t.jobId === id),
  };
}

/**
 * Google Business Profile snapshot. Read from the `google_business_snapshot`
 * table (updated by hand on the Settings page); falls back to the fixture as the
 * pre-Supabase default, same pattern as everything else.
 */
export async function getGoogleBusinessSnapshot(): Promise<GoogleBusinessSnapshot> {
  if (!isSupabaseConfigured()) return fixtureGoogleBusiness;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('google_business_snapshot')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn(`[db] google_business_snapshot read failed (${error.message}); using fixture.`);
      return fixtureGoogleBusiness;
    }
    if (!data) return fixtureGoogleBusiness;
    const r = data as Row;
    return {
      rating: num(r.rating, fixtureGoogleBusiness.rating),
      reviewCount: num(r.review_count),
      phone: str(r.phone),
      hours: str(r.hours),
      profileStrengthOk: bool(r.profile_strength_ok),
      facebookFollowers: num(r.facebook_followers),
      instagramFollowers: num(r.instagram_followers),
      updatedAt: str(r.updated_at),
    };
  } catch (err) {
    console.warn(`[db] google_business_snapshot read threw (${(err as Error).message}); using fixture.`);
    return fixtureGoogleBusiness;
  }
}

// ── Phase C: internal operating reads ────────────────────────────────────────

function rowToTask(r: Row): Task {
  return {
    id: str(r.id),
    title: str(r.title, 'Untitled task'),
    description: optStr(r.description),
    status: str(r.status, 'open') as Task['status'],
    priority: str(r.priority, 'normal') as Task['priority'],
    dueDate: optStr(r.due_date),
    dueAt: optStr(r.due_at),
    entityType: optStr(r.entity_type) as Task['entityType'],
    entityId: optStr(r.entity_id),
    isPersonal: bool(r.is_personal),
    source: str(r.source, 'manual') as Task['source'],
    snoozedUntil: optStr(r.snoozed_until),
    completedAt: optStr(r.completed_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

function rowToCalendarEvent(r: Row): CalendarEvent {
  return {
    id: str(r.id),
    title: str(r.title, 'Untitled event'),
    description: optStr(r.description),
    kind: str(r.kind, 'personal') as CalendarEvent['kind'],
    isPersonal: bool(r.is_personal, true),
    startsAt: str(r.starts_at),
    endsAt: optStr(r.ends_at),
    allDay: bool(r.all_day),
    entityType: optStr(r.entity_type),
    entityId: optStr(r.entity_id),
    source: str(r.source, 'internal') as CalendarEvent['source'],
    createdAt: str(r.created_at),
  };
}

function rowToNote(r: Row): NoteRecord {
  return {
    id: str(r.id),
    entityType: str(r.entity_type, 'job') as NoteRecord['entityType'],
    entityId: str(r.entity_id),
    body: str(r.body),
    createdBy: optStr(r.created_by),
    createdAt: str(r.created_at),
  };
}

function rowToActivity(r: Row): ActivityEntry {
  return {
    id: str(r.id),
    actor: str(r.actor, 'human') as ActivityEntry['actor'],
    verb: str(r.verb),
    entityType: optStr(r.entity_type),
    entityId: optStr(r.entity_id),
    summary: str(r.summary),
    createdAt: str(r.created_at),
  };
}

export function getTasks(): Promise<Task[]> {
  return readList({ table: 'tasks', map: rowToTask, fixture: fixtureTasks, order: { column: 'created_at', ascending: false } });
}

export function getCalendarEvents(): Promise<CalendarEvent[]> {
  return readList({ table: 'calendar_events', map: rowToCalendarEvent, fixture: fixtureCalendarEvents, order: { column: 'starts_at', ascending: true } });
}

export function getNotes(): Promise<NoteRecord[]> {
  return readList({ table: 'notes', map: rowToNote, fixture: fixtureNotes, order: { column: 'created_at', ascending: false } });
}

/** Recent activity, newest first (capped — the feed is a pulse, not an archive). */
export async function getActivity(limit = 30): Promise<ActivityEntry[]> {
  const all = await readList({ table: 'activity_log', map: rowToActivity, fixture: fixtureActivity, order: { column: 'created_at', ascending: false } });
  return all.slice(0, limit);
}

/** Attention item states, keyed by item id. Missing key = 'open'. */
export async function getAttentionStates(): Promise<Map<string, AttentionStateRecord>> {
  const rows = await readList<AttentionStateRecord>({
    table: 'attention_states',
    map: (r) => ({
      itemKey: str(r.item_key),
      state: str(r.state, 'open') as AttentionStateRecord['state'],
      snoozedUntil: optStr(r.snoozed_until),
      updatedAt: str(r.updated_at),
    }),
    fixture: [],
  });
  return new Map(rows.map((r) => [r.itemKey, r]));
}

/** Internal pipeline-review classifications, keyed by quote id. */
export async function getQuoteReviews(): Promise<Map<string, QuoteReviewRecord>> {
  const rows = await readList<QuoteReviewRecord>({
    table: 'quote_reviews',
    map: (r) => ({
      quoteId: str(r.quote_id),
      classification: str(r.classification, 'needs_research') as QuoteReviewRecord['classification'],
      note: optStr(r.note),
      reviewedAt: str(r.reviewed_at),
    }),
    fixture: [],
  });
  return new Map(rows.map((r) => [r.quoteId, r]));
}
