import Link from 'next/link';
import { Suspense } from 'react';
import {
  getCustomers,
  getEmailIntelligence,
  getEmailMessages,
  getEmailThreads,
  getLeadCandidates,
} from '@/lib/db';
import { isEmailConfigured, loadEmailAccount } from '@/lib/email/gmail';
import type { EmailIntelligenceRecord, EmailThread, LeadCandidate } from '@/lib/db/types';
import { PageHeader, Card, StatusBadge } from '@/app/components/ui';
import { EmptyState, TableSkeleton } from '@/app/components/states';
import { formatDateTime, relativeTime } from '@/app/components/format';
import { CandidateActions } from '@/app/components/CandidateActions';
import { ThreadStatusButtons } from '@/app/components/ThreadStatusButtons';

export const dynamic = 'force-dynamic';

/**
 * Lead & Opportunity Inbox — everything the email intelligence layer detected,
 * waiting for owner judgment. The system NEVER acts on a candidate by itself:
 * no Jobber leads are created, no mail is touched. Detection is deterministic
 * (rules:v1) and always labeled as interpretation, never presented as fact.
 */

const RELEVANT = new Set(['new_lead', 'bid_invitation', 'existing_customer', 'existing_quote', 'existing_job', 'scheduling']);

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Opportunities"
        description="Leads and bid invitations detected in business email — read-only, rules-based, decided by you."
      />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <Inbox focusThreadId={params.thread} />
      </Suspense>
    </div>
  );
}

async function Inbox({ focusThreadId }: { focusThreadId?: string }) {
  const configured = isEmailConfigured();
  const [account, candidates, threads, intel, customers] = await Promise.all([
    configured ? loadEmailAccount() : Promise.resolve(null),
    getLeadCandidates(),
    getEmailThreads(),
    getEmailIntelligence(),
    getCustomers(),
  ]);

  const connected = Boolean(account);
  if (!connected && candidates.length === 0 && threads.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Email isn’t connected yet"
          message="Connect the business mailbox (read-only) in Settings and detected leads and bid invitations will queue here for review."
        />
        <div className="pb-2 text-center">
          <Link href="/settings" className="text-sm font-medium text-accent hover:underline">
            Go to Settings →
          </Link>
        </div>
      </Card>
    );
  }

  const open = candidates.filter((c) => c.status === 'new');
  const handled = candidates.filter((c) => c.status !== 'new').slice(0, 8);
  const customerOptions = customers.map((c) => ({ id: c.id, name: c.name }));
  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));

  const relevantThreads = threads.filter((t) => {
    const i = intel.get(t.id);
    return t.status !== 'dismissed' && (i ? RELEVANT.has(i.classification) : false);
  });
  const noiseCount = threads.length - relevantThreads.length;
  const focused = focusThreadId ? threads.find((t) => t.id === focusThreadId) : undefined;

  return (
    <div className="space-y-6">
      <Card
        title={`Lead candidates${open.length > 0 ? ` (${open.length} new)` : ''}`}
        actions={
          connected ? (
            <span className="text-xs text-ink-4">from {account?.address}</span>
          ) : undefined
        }
      >
        {open.length === 0 ? (
          <EmptyState
            title="Inbox zero"
            message={
              connected
                ? 'No unreviewed lead candidates. New ones appear here as email is scanned.'
                : 'No unreviewed candidates.'
            }
          />
        ) : (
          <ul className="divide-y divide-edge-soft">
            {open.map((c) => (
              <li key={c.id} className="py-4 first:pt-1 last:pb-1">
                <CandidateRow candidate={c} customers={customerOptions} />
              </li>
            ))}
          </ul>
        )}
        {handled.length > 0 && (
          <details className="mt-3 border-t border-edge-soft pt-3">
            <summary className="cursor-pointer select-none text-xs font-medium text-ink-4 hover:text-ink-2">
              Recently handled ({handled.length})
            </summary>
            <ul className="mt-2 space-y-1.5">
              {handled.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 text-xs text-ink-3">
                  <span className="min-w-0 truncate">
                    {c.company || c.contactName}
                    {c.linkedCustomerId && customerNameById.has(c.linkedCustomerId) && (
                      <> → <Link href={`/customers/${c.linkedCustomerId}`} className="text-accent hover:underline">{customerNameById.get(c.linkedCustomerId)}</Link></>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={c.status} />
                    <span className="text-ink-4">{relativeTime(c.reviewedAt ?? c.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {focused && <ThreadDetail thread={focused} intel={intel.get(focused.id)} customerNameById={customerNameById} />}

      <Card title="Business email threads">
        {relevantThreads.length === 0 ? (
          <EmptyState
            title="Nothing relevant yet"
            message={
              connected
                ? 'Threads classified as leads, bids, or customer conversations will list here.'
                : 'Connect email in Settings to populate this list.'
            }
          />
        ) : (
          <ul className="divide-y divide-edge-soft">
            {relevantThreads.slice(0, 25).map((t) => {
              const i = intel.get(t.id);
              return (
                <li key={t.id}>
                  <Link
                    href={`/opportunities?thread=${t.id}`}
                    className={`flex items-start justify-between gap-3 rounded-lg px-2 py-3 transition hover:bg-panel-2 ${
                      focusThreadId === t.id ? 'bg-panel-2' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{t.subject || '(no subject)'}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-4">
                        {t.participants.map((p) => p.name || p.address).join(', ') || 'unknown sender'} · {t.messageCount}{' '}
                        message{t.messageCount === 1 ? '' : 's'}
                        {i?.summary ? ` — ${i.summary}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {i && <ClassificationBadge intel={i} />}
                      <span className="text-xs text-ink-4">{relativeTime(t.lastMessageAt)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {noiseCount > 0 && (
          <p className="mt-3 border-t border-edge-soft pt-2 text-xs text-ink-4">
            {noiseCount} other thread{noiseCount === 1 ? '' : 's'} classified as noise (newsletters, notifications,
            vendors) — kept out of the way, never deleted.
          </p>
        )}
      </Card>
    </div>
  );
}

function CandidateRow({ candidate: c, customers }: { candidate: LeadCandidate; customers: { id: string; name: string }[] }) {
  const facts = [c.estimatedScope, c.location].filter(Boolean).join(' · ');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ink">{c.company || c.contactName || 'Unknown sender'}</span>
            <SourceBadge source={c.source} />
          </div>
          <div className="mt-0.5 text-xs text-ink-4">
            {[c.contactName && c.contactName !== c.company ? c.contactName : null, c.contactEmail, c.contactPhone]
              .filter(Boolean)
              .join(' · ') || '—'}
          </div>
        </div>
        <span className="shrink-0 text-xs text-ink-4">{relativeTime(c.createdAt)}</span>
      </div>
      {facts && <div className="text-sm font-medium text-accent">{facts}</div>}
      {c.summary && <p className="text-sm leading-snug text-ink-2">{c.summary}</p>}
      {c.emailThreadId && (
        <Link href={`/opportunities?thread=${c.emailThreadId}`} className="inline-block text-xs font-medium text-accent hover:underline">
          Read the email thread →
        </Link>
      )}
      <CandidateActions id={c.id} customers={customers} />
    </div>
  );
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  new_lead: 'Possible lead',
  bid_invitation: 'Bid invitation',
  existing_customer: 'Customer',
  existing_quote: 'Quote follow-up',
  existing_job: 'Active job',
  scheduling: 'Scheduling',
  payment_accounting: 'Payment',
  vendor: 'Vendor',
  internal_admin: 'Admin',
  newsletter_marketing: 'Marketing',
  unknown: 'Unclassified',
};

function ClassificationBadge({ intel }: { intel: EmailIntelligenceRecord }) {
  const hot = intel.classification === 'new_lead' || intel.classification === 'bid_invitation';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        hot ? 'bg-sky-400/10 text-sky-300 ring-sky-400/20' : 'bg-panel-2 text-ink-3 ring-edge'
      }`}
      title={`Detected by ${intel.mechanism} — interpretation, not source data`}
    >
      {intel.urgency === 'urgent' && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warn" />}
      {CLASSIFICATION_LABEL[intel.classification] ?? intel.classification}
    </span>
  );
}

function SourceBadge({ source }: { source: LeadCandidate['source'] }) {
  const label = source === 'email' ? 'Email' : source === 'market_radar' ? 'Market Radar' : source === 'website' ? 'Website' : 'Manual';
  return (
    <span className="inline-flex items-center rounded-full bg-panel-2 px-2 py-0.5 text-[11px] font-medium text-ink-3 ring-1 ring-inset ring-edge">
      {label}
    </span>
  );
}

async function ThreadDetail({
  thread,
  intel,
  customerNameById,
}: {
  thread: EmailThread;
  intel: EmailIntelligenceRecord | undefined;
  customerNameById: Map<string, string>;
}) {
  const messages = await getEmailMessages(thread.id);
  return (
    <Card
      title={thread.subject || '(no subject)'}
      actions={
        <Link href="/opportunities" className="text-xs font-medium text-ink-4 hover:text-ink-2">
          Close ✕
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-4">
          {intel && <ClassificationBadge intel={intel} />}
          {thread.linkedCustomerId && customerNameById.has(thread.linkedCustomerId) && (
            <Link href={`/customers/${thread.linkedCustomerId}`} className="font-medium text-accent hover:underline">
              {customerNameById.get(thread.linkedCustomerId)} →
            </Link>
          )}
          <span>
            {thread.messageCount} message{thread.messageCount === 1 ? '' : 's'}
          </span>
          <StatusBadge status={thread.status} />
        </div>
        {intel?.summary && (
          <p className="rounded-lg border border-edge-soft bg-panel-2/50 p-3 text-sm leading-snug text-ink-2">
            <span className="mr-1.5 inline-block rounded bg-panel px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-4">
              Detected · {intel.mechanism}
            </span>
            {intel.summary}
          </p>
        )}
        {messages.length === 0 ? (
          <p className="text-sm text-ink-4">Messages for this thread aren’t loaded yet.</p>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => (
              <li key={m.id} className="rounded-lg border border-edge-soft p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-ink-2">{m.fromName || m.fromAddress}</span>
                  <span className="text-ink-4">{formatDateTime(m.sentAt)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-3">{m.bodyExtract || '(no text)'}</p>
                {m.hasAttachments && (
                  <p className="mt-2 text-xs text-ink-4">
                    📎 {m.attachmentMeta.map((a) => a.filename).join(', ') || 'attachments'}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <ThreadStatusButtons threadId={thread.id} status={thread.status} />
      </div>
    </Card>
  );
}
