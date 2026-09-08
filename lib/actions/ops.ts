'use server';

/**
 * Domain action layer — every internal write goes through here.
 *
 * These functions are the Business OS's controlled operations. In Phase D they
 * become the tools Claude is allowed to call (with an approval step for
 * mutations); Claude will NEVER get broader database access than this file.
 *
 * Every mutation:
 *   1. authenticates (Supabase session) and validates business membership
 *   2. validates input server-side (zod — browser-supplied data is untrusted)
 *   3. performs the write under the USER'S session, so RLS is enforced
 *   4. appends an audit record (who/what/old/new/mechanism)
 *   5. appends a human-readable activity entry
 *
 * Never touches Jobber or QuickBooks — internal records only.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export interface OpResult {
  ok: boolean;
  message?: string;
  id?: string;
}

const NOT_CONFIGURED: OpResult = {
  ok: false,
  message: 'Writes need the live database — the app is running on sample data right now.',
};

// ── auth guard ───────────────────────────────────────────────────────────────

async function requireMember(): Promise<
  { supabase: SupabaseClient; userId: string } | { error: OpResult }
> {
  if (!isSupabaseConfigured()) return { error: NOT_CONFIGURED };
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: { ok: false, message: 'Not signed in.' } };
  const { data: membership } = await supabase
    .from('business_members')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) return { error: { ok: false, message: 'Your account isn’t linked to the business.' } };
  return { supabase, userId: user.id };
}

// ── audit + activity ─────────────────────────────────────────────────────────

async function record(
  supabase: SupabaseClient,
  userId: string,
  entry: {
    action: string;
    verb: string;
    summary: string;
    entityType?: string;
    entityId?: string;
    oldState?: unknown;
    newState?: unknown;
  },
) {
  // Best-effort: a failed log line must not fail the user's action, but it IS
  // loudly reported.
  const [audit, activity] = await Promise.all([
    supabase.from('audit_log').insert({
      actor_user: userId,
      mechanism: 'human',
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      old_state: entry.oldState ?? null,
      new_state: entry.newState ?? null,
    }),
    supabase.from('activity_log').insert({
      actor: 'human',
      actor_user: userId,
      verb: entry.verb,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      summary: entry.summary,
    }),
  ]);
  if (audit.error) console.error(`[audit] write failed: ${audit.error.message}`);
  if (activity.error) console.error(`[activity] write failed: ${activity.error.message}`);
}

function refresh() {
  revalidatePath('/', 'layout');
}

// ── schemas ──────────────────────────────────────────────────────────────────

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoInstant = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid timestamp');

const taskInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  dueDate: dateOnly.optional(),
  dueAt: isoInstant.optional(),
  entityType: z.enum(['job', 'quote', 'invoice', 'lead']).optional(),
  entityId: uuid.optional(),
  isPersonal: z.boolean().default(false),
  source: z.enum(['manual', 'attention', 'job']).default('manual'),
  reminderAt: isoInstant.optional(),
});

/** An entity link needs BOTH halves; verify the target actually exists (RLS-scoped). */
async function verifyEntity(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  const table =
    entityType === 'job' ? 'jobs' : entityType === 'quote' ? 'quotes' : entityType === 'invoice' ? 'invoices' : 'leads';
  const { data } = await supabase.from(table).select('id').eq('id', entityId).maybeSingle();
  return Boolean(data);
}

// ── tasks ────────────────────────────────────────────────────────────────────

export async function createTask(raw: z.input<typeof taskInput>): Promise<OpResult> {
  const auth = await requireMember();
  if ('error' in auth) return auth.error;
  const parsed = taskInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid task.' };
  const input = parsed.data;

  if ((input.entityType && !input.entityId) || (!input.entityType && input.entityId)) {
    return { ok: false, message: 'Entity link needs both a type and an id.' };
  }
  if (input.entityType && input.entityId) {
    if (!(await verifyEntity(auth.supabase, input.entityType, input.entityId))) {
      return { ok: false, message: 'That record doesn’t exist.' };
    }
  }

  const row = {
    title: input.title,
    description: input.description ?? null,
    priority: input.priority,
    due_date: input.dueDate ?? (input.dueAt ? input.dueAt.slice(0, 10) : null),
    due_at: input.dueAt ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    is_personal: input.isPersonal,
    source: input.source,
    reminder_at: input.reminderAt ?? null,
    created_by: auth.userId,
  };
  const { data, error } = await auth.supabase.from('tasks').insert(row).select('id').single();
  if (error) return { ok: false, message: `Couldn’t create the task: ${error.message}` };

  await record(auth.supabase, auth.userId, {
    action: 'task.create',
    verb: 'task.created',
    summary: `Created task “${input.title}”`,
    entityType: input.entityType ?? 'task',
    entityId: input.entityId ?? data.id,
    newState: row,
  });
  refresh();
  return { ok: true, id: data.id };
}

const taskUpdate = z.object({
  id: uuid,
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
  dueDate: dateOnly.nullable().optional(),
  dueAt: isoInstant.nullable().optional(),
  snoozedUntil: isoInstant.nullable().optional(),
});

export async function updateTask(raw: z.input<typeof taskUpdate>): Promise<OpResult> {
  const auth = await requireMember();
  if ('error' in auth) return auth.error;
  const parsed = taskUpdate.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid update.' };
  const input = parsed.data;

  const { data: existing, error: readErr } = await auth.supabase
    .from('tasks')
    .select('*')
    .eq('id', input.id)
    .maybeSingle();
  if (readErr || !existing) return { ok: false, message: 'Task not found.' };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.dueDate !== undefined) patch.due_date = input.dueDate;
  if (input.dueAt !== undefined) {
    patch.due_at = input.dueAt;
    if (input.dueAt) patch.due_date = input.dueAt.slice(0, 10);
  }
  if (input.snoozedUntil !== undefined) patch.snoozed_until = input.snoozedUntil;
  if (input.status !== undefined) {
    patch.status = input.status;
    patch.completed_at = input.status === 'done' ? new Date().toISOString() : null;
  }

  const { error } = await auth.supabase.from('tasks').update(patch).eq('id', input.id);
  if (error) return { ok: false, message: `Couldn’t update the task: ${error.message}` };

  const verb =
    input.status === 'done'
      ? 'task.completed'
      : input.status === 'cancelled'
        ? 'task.cancelled'
        : input.dueDate !== undefined || input.dueAt !== undefined
          ? 'task.rescheduled'
          : 'task.updated';
  await record(auth.supabase, auth.userId, {
    action: 'task.update',
    verb,
    summary:
      verb === 'task.completed'
        ? `Completed “${existing.title}”`
        : verb === 'task.rescheduled'
          ? `Rescheduled “${existing.title}”`
          : `Updated “${existing.title}”`,
    entityType: 'task',
    entityId: input.id,
    oldState: existing,
    newState: patch,
  });
  refresh();
  return { ok: true, id: input.id };
}

export async function completeTask(id: string): Promise<OpResult> {
  return updateTask({ id, status: 'done' });
}

export async function reopenTask(id: string): Promise<OpResult> {
  return updateTask({ id, status: 'open' });
}

// ── calendar events ──────────────────────────────────────────────────────────

const eventInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
  kind: z.enum(['personal', 'business', 'meeting', 'reminder', 'blocked']).default('personal'),
  isPersonal: z.boolean().default(true),
  startsAt: isoInstant,
  endsAt: isoInstant.optional(),
  allDay: z.boolean().default(false),
});

export async function createEvent(raw: z.input<typeof eventInput>): Promise<OpResult> {
  const auth = await requireMember();
  if ('error' in auth) return auth.error;
  const parsed = eventInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid event.' };
  const input = parsed.data;
  if (input.endsAt && Date.parse(input.endsAt) < Date.parse(input.startsAt)) {
    return { ok: false, message: 'The event can’t end before it starts.' };
  }

  const row = {
    title: input.title,
    description: input.description ?? null,
    kind: input.kind,
    is_personal: input.isPersonal,
    starts_at: input.startsAt,
    ends_at: input.endsAt ?? null,
    all_day: input.allDay,
    source: 'internal',
    created_by: auth.userId,
  };
  const { data, error } = await auth.supabase.from('calendar_events').insert(row).select('id').single();
  if (error) return { ok: false, message: `Couldn’t create the event: ${error.message}` };

  await record(auth.supabase, auth.userId, {
    action: 'event.create',
    verb: 'event.created',
    summary: `Added ${input.isPersonal ? 'personal ' : ''}event “${input.title}”`,
    entityType: 'event',
    entityId: data.id,
    newState: row,
  });
  refresh();
  return { ok: true, id: data.id };
}

const eventReschedule = z.object({ id: uuid, startsAt: isoInstant, endsAt: isoInstant.nullable().optional() });

export async function rescheduleEvent(raw: z.input<typeof eventReschedule>): Promise<OpResult> {
  const auth = await requireMember();
  if ('error' in auth) return auth.error;
  const parsed = eventReschedule.safeParse(raw);
  if (!parsed.success) return { ok: false, message: 'Invalid reschedule.' };

  const { data: existing } = await auth.supabase
    .from('calendar_events')
    .select('*')
    .eq('id', parsed.data.id)
    .maybeSingle();
  if (!existing) return { ok: false, message: 'Event not found.' };
  if (existing.source !== 'internal') {
    return { ok: false, message: 'Synced events can’t be rescheduled from here.' };
  }

  // Preserve duration when only a new start is given.
  let endsAt = parsed.data.endsAt ?? null;
  if (endsAt === undefined || endsAt === null) {
    if (existing.ends_at && existing.starts_at) {
      const duration = Date.parse(existing.ends_at) - Date.parse(existing.starts_at);
      endsAt = new Date(Date.parse(parsed.data.startsAt) + duration).toISOString();
    }
  }

  const patch = { starts_at: parsed.data.startsAt, ends_at: endsAt, updated_at: new Date().toISOString() };
  const { error } = await auth.supabase.from('calendar_events').update(patch).eq('id', parsed.data.id);
  if (error) return { ok: false, message: `Couldn’t reschedule: ${error.message}` };

  await record(auth.supabase, auth.userId, {
    action: 'event.reschedule',
    verb: 'event.rescheduled',
    summary: `Rescheduled “${existing.title}”`,
    entityType: 'event',
    entityId: parsed.data.id,
    oldState: { starts_at: existing.starts_at, ends_at: existing.ends_at },
    newState: patch,
  });
  refresh();
  return { ok: true, id: parsed.data.id };
}

export async function deleteEvent(id: string): Promise<OpResult> {
  const auth = await requireMember();
  if ('error' in auth) return auth.error;
  if (!uuid.safeParse(id).success) return { ok: false, message: 'Invalid event.' };
  const { data: existing } = await auth.supabase.from('calendar_events').select('*').eq('id', id).maybeSingle();
  if (!existing) return { ok: false, message: 'Event not found.' };
  if (existing.source !== 'internal') return { ok: false, message: 'Synced events can’t be deleted from here.' };
  const { error } = await auth.supabase.from('calendar_events').delete().eq('id', id);
  if (error) return { ok: false, message: `Couldn’t delete: ${error.message}` };
  await record(auth.supabase, auth.userId, {
    action: 'event.delete',
    verb: 'event.deleted',
    summary: `Removed event “${existing.title}”`,
    entityType: 'event',
    entityId: id,
    oldState: existing,
  });
  refresh();
  return { ok: true };
}

// ── notes ────────────────────────────────────────────────────────────────────

const noteInput = z.object({
  entityType: z.enum(['job', 'quote', 'invoice', 'lead', 'task']),
  entityId: uuid,
  body: z.string().trim().min(1).max(8000),
});

export async function addNote(raw: z.input<typeof noteInput>): Promise<OpResult> {
  const auth = await requireMember();
  if ('error' in auth) return auth.error;
  const parsed = noteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid note.' };
  const input = parsed.data;

  if (input.entityType !== 'task') {
    if (!(await verifyEntity(auth.supabase, input.entityType, input.entityId))) {
      return { ok: false, message: 'That record doesn’t exist.' };
    }
  }

  const { data, error } = await auth.supabase
    .from('notes')
    .insert({ entity_type: input.entityType, entity_id: input.entityId, body: input.body, created_by: auth.userId })
    .select('id')
    .single();
  if (error) return { ok: false, message: `Couldn’t add the note: ${error.message}` };

  await record(auth.supabase, auth.userId, {
    action: 'note.add',
    verb: 'note.added',
    summary: `Added a note to ${input.entityType} record`,
    entityType: input.entityType,
    entityId: input.entityId,
    newState: { body: input.body },
  });
  refresh();
  return { ok: true, id: data.id };
}

// ── attention states ─────────────────────────────────────────────────────────

const attentionInput = z.object({
  itemKey: z.string().trim().min(1).max(200),
  state: z.enum(['open', 'acknowledged', 'snoozed', 'resolved']),
  snoozedUntil: isoInstant.optional(),
});

/** Internal only — acknowledging an alert never modifies Jobber records. */
export async function setAttentionState(raw: z.input<typeof attentionInput>): Promise<OpResult> {
  const auth = await requireMember();
  if ('error' in auth) return auth.error;
  const parsed = attentionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: 'Invalid attention update.' };
  const input = parsed.data;
  if (input.state === 'snoozed' && !input.snoozedUntil) {
    return { ok: false, message: 'A snooze needs a wake-up time.' };
  }

  const { error } = await auth.supabase.from('attention_states').upsert(
    {
      item_key: input.itemKey,
      state: input.state,
      snoozed_until: input.state === 'snoozed' ? input.snoozedUntil : null,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'item_key' },
  );
  if (error) return { ok: false, message: `Couldn’t update: ${error.message}` };

  await record(auth.supabase, auth.userId, {
    action: 'attention.state',
    verb: `attention.${input.state}`,
    summary: `Marked attention item ${input.state}${input.state === 'snoozed' ? ` until ${input.snoozedUntil!.slice(0, 10)}` : ''}`,
    entityType: 'attention',
    newState: input,
  });
  refresh();
  return { ok: true };
}

// ── pipeline review ──────────────────────────────────────────────────────────

const classifyInput = z.object({
  quoteId: uuid,
  classification: z.enum(['active', 'follow_up', 'likely_dead', 'known_lost', 'needs_research']),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Internal classification only — NEVER changes the quote in Jobber. Adjusted
 * pipeline excludes likely_dead/known_lost while the raw number stays intact.
 */
export async function classifyQuote(raw: z.input<typeof classifyInput>): Promise<OpResult> {
  const auth = await requireMember();
  if ('error' in auth) return auth.error;
  const parsed = classifyInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: 'Invalid classification.' };
  const input = parsed.data;

  const { data: quote } = await auth.supabase
    .from('quotes')
    .select('id, number, client_name, amount')
    .eq('id', input.quoteId)
    .maybeSingle();
  if (!quote) return { ok: false, message: 'Quote not found.' };

  const { data: existing } = await auth.supabase
    .from('quote_reviews')
    .select('classification')
    .eq('quote_id', input.quoteId)
    .maybeSingle();

  const { error } = await auth.supabase.from('quote_reviews').upsert(
    {
      quote_id: input.quoteId,
      classification: input.classification,
      note: input.note ?? null,
      reviewed_by: auth.userId,
      reviewed_at: new Date().toISOString(),
    },
    { onConflict: 'quote_id' },
  );
  if (error) return { ok: false, message: `Couldn’t save the review: ${error.message}` };

  await record(auth.supabase, auth.userId, {
    action: 'quote.classify',
    verb: 'quote.classified',
    summary: `Classified Quote ${quote.number} as ${input.classification.replace(/_/g, ' ')}`,
    entityType: 'quote',
    entityId: input.quoteId,
    oldState: existing ?? null,
    newState: { classification: input.classification },
  });
  refresh();
  return { ok: true };
}
