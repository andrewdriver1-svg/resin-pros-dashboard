/**
 * Email ingest — idempotent sync from the provider into the OS.
 *
 * Split for testability:
 *   planIngest()  — PURE: (new normalized messages + existing state + match
 *                   context) → exactly the rows to write. All dedupe,
 *                   threading, classification, matching and candidate
 *                   decisions live here and run identically in tests.
 *   syncEmail()   — the I/O wrapper: fetch from Gmail since the watermark,
 *                   ask planIngest what to write, write it (service role),
 *                   advance the watermark, record a sync_runs row.
 *
 * Idempotency: messages dedupe on provider_message_id, threads on
 * provider_thread_id, candidates on email_thread_id (partial unique index) —
 * re-running a window writes nothing new. The mailbox itself is never
 * modified (read-only scope).
 */

import { businessConfig } from '@/config/business.config';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  classifyEmail,
  emailDomain,
  shouldCreateCandidate,
  type EmailInterpretation,
  type MatchContext,
} from './classify';
import {
  GmailClient,
  loadEmailAccount,
  updateEmailAccountState,
  type NormalizedMessage,
  normalizeGmailMessage,
} from './gmail';

// ── plan shapes ──────────────────────────────────────────────────────────────

export interface ExistingThreadState {
  id: string;
  providerThreadId: string;
  status: 'open' | 'reviewed' | 'dismissed';
  linkMechanism?: string;
  messageCount: number;
  participants: { address: string; name?: string }[];
  firstMessageAt?: string;
  subject?: string;
  hasCandidate: boolean;
}

export interface ThreadUpsert {
  providerThreadId: string;
  subject: string;
  participants: { address: string; name?: string }[];
  messageCount: number;
  firstMessageAt: string;
  lastMessageAt: string;
  /** Deterministic link — applied only when no manual link exists. */
  link?: {
    customerId?: string;
    entityType?: 'quote' | 'invoice' | 'job' | 'lead';
    entityId?: string;
    confidence: number;
    mechanism: string;
  };
}

export interface CandidatePlan {
  providerThreadId: string;
  company: string;
  contactName: string;
  contactEmail?: string;
  summary: string;
  location?: string;
  estimatedScope?: string;
}

export interface IngestPlan {
  messages: NormalizedMessage[];
  threads: ThreadUpsert[];
  intelligence: { providerThreadId: string; interpretation: EmailInterpretation }[];
  candidates: CandidatePlan[];
  relevantCount: number;
}

const RELEVANT = new Set([
  'new_lead',
  'bid_invitation',
  'existing_customer',
  'existing_quote',
  'existing_job',
  'scheduling',
  'payment_accounting',
]);

export function ownAddressContext(): Pick<MatchContext, 'ownAddresses' | 'ownDomain'> {
  const own = businessConfig.contact.email.toLowerCase();
  return { ownAddresses: [own], ownDomain: emailDomain(own) || undefined };
}

/** Merge participant lists, external addresses only, deduped by address. */
function mergeParticipants(
  existing: { address: string; name?: string }[],
  msgs: NormalizedMessage[],
  ownAddresses: string[],
): { address: string; name?: string }[] {
  const map = new Map<string, { address: string; name?: string }>();
  for (const p of existing) map.set(p.address, p);
  for (const m of msgs) {
    for (const addr of [m.fromAddress, ...m.toAddresses]) {
      if (!addr || ownAddresses.includes(addr)) continue;
      const prev = map.get(addr);
      const name = addr === m.fromAddress ? m.fromName : undefined;
      if (!prev || (!prev.name && name)) map.set(addr, { address: addr, name: name || prev?.name });
    }
  }
  return Array.from(map.values()).slice(0, 20);
}

export function planIngest(
  fetched: NormalizedMessage[],
  existingMessageIds: Set<string>,
  existingThreads: Map<string, ExistingThreadState>,
  ctx: MatchContext,
): IngestPlan {
  // 1) Dedupe: only messages the OS has never seen.
  const fresh = fetched.filter((m) => !existingMessageIds.has(m.providerMessageId));

  // 2) Group by provider thread.
  const byThread = new Map<string, NormalizedMessage[]>();
  for (const m of fresh) {
    const list = byThread.get(m.providerThreadId) ?? [];
    list.push(m);
    byThread.set(m.providerThreadId, list);
  }

  const threads: ThreadUpsert[] = [];
  const intelligence: IngestPlan['intelligence'] = [];
  const candidates: CandidatePlan[] = [];
  let relevantCount = 0;

  for (const [providerThreadId, msgs] of byThread) {
    msgs.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    const existing = existingThreads.get(providerThreadId);
    const newest = msgs[msgs.length - 1];
    const oldest = msgs[0];

    // Classify on the newest EXTERNAL message (an outbound-only thread is
    // internal correspondence, not an actionable inbound conversation).
    const newestExternal = [...msgs].reverse().find((m) => !ctx.ownAddresses.includes(m.fromAddress));
    const basis = newestExternal ?? newest;
    const interpretation = classifyEmail(
      {
        fromAddress: basis.fromAddress,
        fromName: basis.fromName,
        subject: basis.subject || existing?.subject || '',
        bodyExtract: basis.bodyExtract,
        hasListUnsubscribe: basis.hasListUnsubscribe,
      },
      ctx,
    );
    if (RELEVANT.has(interpretation.classification)) relevantCount += msgs.length;

    threads.push({
      providerThreadId,
      subject: existing?.subject || oldest.subject || newest.subject || '(no subject)',
      participants: mergeParticipants(existing?.participants ?? [], msgs, ctx.ownAddresses),
      messageCount: (existing?.messageCount ?? 0) + msgs.length,
      firstMessageAt: existing?.firstMessageAt ?? oldest.sentAt,
      lastMessageAt: newest.sentAt,
      // A manual link is the owner's judgment — the matcher never overwrites it.
      link:
        existing?.linkMechanism === 'manual'
          ? undefined
          : interpretation.match
            ? {
                customerId: interpretation.match.customerId,
                entityType: interpretation.match.entityType,
                entityId: interpretation.match.entityId,
                confidence: interpretation.match.confidence,
                mechanism: interpretation.match.mechanism,
              }
            : undefined,
    });

    intelligence.push({ providerThreadId, interpretation });

    // Lead Inbox: uncertain inbound business awaiting the owner. Never for
    // threads the owner already dismissed, and never twice per thread.
    if (
      shouldCreateCandidate(interpretation) &&
      !(existing?.hasCandidate ?? false) &&
      existing?.status !== 'dismissed'
    ) {
      candidates.push({
        providerThreadId,
        company: interpretation.detectedCompany ?? basis.fromName ?? '',
        contactName: basis.fromName || basis.fromAddress,
        contactEmail: basis.fromAddress,
        summary: `${basis.subject || 'Inquiry'} — ${basis.bodyExtract.slice(0, 180)}`.trim(),
        location: interpretation.detectedLocation,
        estimatedScope: interpretation.detectedScope,
      });
    }
  }

  return { messages: fresh, threads, intelligence, candidates, relevantCount };
}

// ── I/O sync ─────────────────────────────────────────────────────────────────

export interface EmailSyncResult {
  ok: boolean;
  messagesScanned: number;
  messagesNew: number;
  messagesRelevant: number;
  candidatesCreated: number;
  errors: string[];
}

const FIRST_SYNC_DAYS = 14;
const MAX_MESSAGES_PER_RUN = 200;
/** Re-scan overlap so a slow write can never orphan a message (dedupe absorbs it). */
const OVERLAP_MS = 60 * 60 * 1000;

export async function syncEmail(): Promise<EmailSyncResult> {
  const result: EmailSyncResult = {
    ok: false,
    messagesScanned: 0,
    messagesNew: 0,
    messagesRelevant: 0,
    candidatesCreated: 0,
    errors: [],
  };
  const admin = createSupabaseAdminClient();
  if (!admin) {
    result.errors.push('Supabase service role not configured.');
    return result;
  }

  try {
    const account = await loadEmailAccount();
    const client = await GmailClient.fromStoredTokens();
    if (!account || !client) {
      result.errors.push('Email is not connected.');
      await recordEmailRun(admin, result);
      return result;
    }

    // Window: watermark minus overlap; first run looks back FIRST_SYNC_DAYS.
    const sinceMs = account.watermarkAt
      ? new Date(account.watermarkAt).getTime() - OVERLAP_MS
      : Date.now() - FIRST_SYNC_DAYS * 86_400_000;
    const query = `after:${Math.floor(sinceMs / 1000)} -in:chats -in:drafts`;

    const ids = await client.listMessageIds(query, MAX_MESSAGES_PER_RUN);
    result.messagesScanned = ids.length;

    // Which of these has the OS already ingested?
    const existingIds = new Set<string>();
    if (ids.length > 0) {
      const { data } = await admin.from('email_messages').select('provider_message_id').in('provider_message_id', ids);
      for (const r of data ?? []) existingIds.add(String(r.provider_message_id));
    }
    const newIds = ids.filter((id) => !existingIds.has(id));
    if (newIds.length === 0) {
      result.ok = true;
      await updateEmailAccountState({ status: 'connected', lastError: null });
      await recordEmailRun(admin, result);
      return result;
    }

    const fetched: NormalizedMessage[] = [];
    for (const id of newIds) {
      try {
        fetched.push(normalizeGmailMessage(await client.getMessage(id)));
      } catch (err) {
        result.errors.push(`message ${id}: ${(err as Error).message}`);
      }
    }

    // Existing thread state for the affected provider threads.
    const threadIds = Array.from(new Set(fetched.map((m) => m.providerThreadId)));
    const existingThreads = new Map<string, ExistingThreadState>();
    if (threadIds.length > 0) {
      const { data } = await admin
        .from('email_threads')
        .select('id, provider_thread_id, status, link_mechanism, message_count, participants, first_message_at, subject')
        .in('provider_thread_id', threadIds);
      const withCandidates = new Set<string>();
      const dbIds = (data ?? []).map((r) => String(r.id));
      if (dbIds.length > 0) {
        const { data: cands } = await admin.from('lead_candidates').select('email_thread_id').in('email_thread_id', dbIds);
        for (const c of cands ?? []) withCandidates.add(String(c.email_thread_id));
      }
      for (const r of data ?? []) {
        existingThreads.set(String(r.provider_thread_id), {
          id: String(r.id),
          providerThreadId: String(r.provider_thread_id),
          status: (r.status as ExistingThreadState['status']) ?? 'open',
          linkMechanism: (r.link_mechanism as string | undefined) ?? undefined,
          messageCount: Number(r.message_count ?? 0),
          participants: Array.isArray(r.participants) ? (r.participants as ExistingThreadState['participants']) : [],
          firstMessageAt: (r.first_message_at as string | undefined) ?? undefined,
          subject: (r.subject as string | undefined) ?? undefined,
          hasCandidate: withCandidates.has(String(r.id)),
        });
      }
    }

    const ctx = await buildMatchContext(admin);
    const plan = planIngest(fetched, existingIds, existingThreads, ctx);
    result.messagesNew = plan.messages.length;
    result.messagesRelevant = plan.relevantCount;

    // Write threads first (messages need thread uuids).
    const threadUuid = new Map<string, string>();
    for (const t of plan.threads) {
      const row: Record<string, unknown> = {
        provider_thread_id: t.providerThreadId,
        subject: t.subject,
        participants: t.participants,
        message_count: t.messageCount,
        first_message_at: t.firstMessageAt,
        last_message_at: t.lastMessageAt,
        last_detected_at: new Date().toISOString(),
      };
      if (t.link) {
        row.linked_customer_id = t.link.customerId ?? null;
        row.linked_entity_type = t.link.entityType ?? null;
        row.linked_entity_id = t.link.entityId ?? null;
        row.link_confidence = t.link.confidence;
        row.link_mechanism = t.link.mechanism;
      }
      const { data, error } = await admin
        .from('email_threads')
        .upsert(row, { onConflict: 'provider_thread_id' })
        .select('id')
        .single();
      if (error) {
        result.errors.push(`thread ${t.providerThreadId}: ${error.message}`);
        continue;
      }
      threadUuid.set(t.providerThreadId, String(data.id));
    }

    for (const m of plan.messages) {
      const tid = threadUuid.get(m.providerThreadId);
      if (!tid) continue;
      const { error } = await admin.from('email_messages').upsert(
        {
          provider_message_id: m.providerMessageId,
          thread_id: tid,
          from_address: m.fromAddress,
          from_name: m.fromName,
          to_addresses: m.toAddresses,
          sent_at: m.sentAt,
          subject: m.subject,
          body_extract: m.bodyExtract,
          has_attachments: m.hasAttachments,
          attachment_meta: m.attachmentMeta,
        },
        { onConflict: 'provider_message_id' },
      );
      if (error) result.errors.push(`msg ${m.providerMessageId}: ${error.message}`);
    }

    for (const i of plan.intelligence) {
      const tid = threadUuid.get(i.providerThreadId);
      if (!tid) continue;
      const it = i.interpretation;
      const { error } = await admin.from('email_intelligence').upsert(
        {
          thread_id: tid,
          classification: it.classification,
          summary: it.summary,
          urgency: it.urgency,
          action_required: it.actionRequired,
          waiting_on: it.waitingOn ?? null,
          lead_likelihood: it.leadLikelihood,
          detected_company: it.detectedCompany ?? null,
          detected_location: it.detectedLocation ?? null,
          detected_scope: it.detectedScope ?? null,
          confidence: it.confidence,
          mechanism: it.mechanism,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'thread_id' },
      );
      if (error) result.errors.push(`intel ${i.providerThreadId}: ${error.message}`);
    }

    for (const c of plan.candidates) {
      const tid = threadUuid.get(c.providerThreadId);
      if (!tid) continue;
      const { error } = await admin.from('lead_candidates').insert({
        source: 'email',
        source_ref: c.providerThreadId,
        email_thread_id: tid,
        company: c.company,
        contact_name: c.contactName,
        contact_email: c.contactEmail ?? null,
        summary: c.summary,
        location: c.location ?? null,
        estimated_scope: c.estimatedScope ?? null,
      });
      if (!error) result.candidatesCreated += 1;
      else if (!error.message.includes('duplicate')) result.errors.push(`candidate: ${error.message}`);
    }

    // Advance the watermark to the newest ingested message.
    const newestAt = plan.messages.reduce((max, m) => (m.sentAt > max ? m.sentAt : max), account.watermarkAt ?? '');
    result.ok = result.errors.length === 0;
    await updateEmailAccountState({
      watermarkAt: newestAt || undefined,
      status: result.ok ? 'connected' : 'error',
      lastError: result.ok ? null : result.errors[0],
    });
  } catch (err) {
    result.errors.push((err as Error).message);
    await updateEmailAccountState({ status: 'error', lastError: (err as Error).message }).catch(() => {});
  }

  await recordEmailRun(admin, result);
  return result;
}

async function buildMatchContext(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
): Promise<MatchContext> {
  const [customers, leads, quotes, invoices, jobs] = await Promise.all([
    admin.from('customers').select('id, name, email'),
    admin.from('leads').select('id, client_name, contact_email'),
    admin.from('quotes').select('id, number, client_name'),
    admin.from('invoices').select('id, number, client_name'),
    admin.from('jobs').select('id, title, client_name, address'),
  ]);
  return {
    ...ownAddressContext(),
    customers: (customers.data ?? []).map((r) => ({ id: String(r.id), name: String(r.name ?? ''), email: (r.email as string | null) ?? undefined })),
    leads: (leads.data ?? []).map((r) => ({ id: String(r.id), clientName: String(r.client_name ?? ''), contactEmail: (r.contact_email as string | null) ?? undefined })),
    quotes: (quotes.data ?? []).map((r) => ({ id: String(r.id), number: String(r.number ?? ''), clientName: String(r.client_name ?? '') })),
    invoices: (invoices.data ?? []).map((r) => ({ id: String(r.id), number: String(r.number ?? ''), clientName: String(r.client_name ?? '') })),
    jobs: (jobs.data ?? []).map((r) => ({ id: String(r.id), title: String(r.title ?? ''), clientName: String(r.client_name ?? ''), address: (r.address as string | null) ?? undefined })),
  };
}

async function recordEmailRun(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  result: EmailSyncResult,
): Promise<void> {
  const { error } = await admin.from('sync_runs').insert({
    source: 'email',
    ok: result.ok,
    errors: result.errors,
    messages_scanned: result.messagesScanned,
    messages_relevant: result.messagesRelevant,
    candidates_created: result.candidatesCreated,
  });
  if (error) console.warn(`[email] could not record sync run: ${error.message}`);
}
