import Link from 'next/link';
import { Suspense } from 'react';
import { getLeads } from '@/lib/db';
import { relativeTime } from '@/app/components/format';
import { PageHeader, Card, StatusBadge, TableWrap } from '@/app/components/ui';
import { EmptyState, TableSkeleton } from '@/app/components/states';

export const dynamic = 'force-dynamic';

/**
 * Read-only deep-link filters used by ⌘K and the Attention Center:
 * ?q=<text> matches name/summary/contact; ?view=attention narrows to new
 * leads waiting 3+ days for first contact.
 */
type Filters = { q?: string; view?: string };

const DAY_MS = 86_400_000;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams;
  return (
    <div className="space-y-6">
      <PageHeader title="Leads" description="New opportunities from Jobber requests, the website, and referrals." />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <LeadsTable filters={filters} />
      </Suspense>
    </div>
  );
}

async function LeadsTable({ filters }: { filters: Filters }) {
  const leads = await getLeads();

  if (leads.length === 0) {
    return (
      <EmptyState
        title="No leads yet"
        message="When a quote request comes in through Jobber or the website, it lands here so you can follow up fast."
      />
    );
  }

  const q = (filters.q ?? '').trim().toLowerCase();
  const attentionCutoff = Date.now() - 3 * DAY_MS;
  const visible = leads
    .filter(
      (lead) =>
        !q ||
        lead.clientName.toLowerCase().includes(q) ||
        lead.summary.toLowerCase().includes(q) ||
        (lead.contactEmail ?? '').toLowerCase().includes(q) ||
        (lead.contactPhone ?? '').toLowerCase().includes(q),
    )
    .filter(
      (lead) =>
        filters.view !== 'attention' ||
        (lead.status === 'new' && new Date(lead.receivedAt).getTime() < attentionCutoff),
    );
  const filtered = Boolean(q || filters.view === 'attention');

  return (
    <Card title={filters.view === 'attention' ? 'Leads needing attention (3+ days, no contact)' : undefined}>
      {filtered && (
        <div className="mb-3 flex items-center justify-between text-xs text-ink-3">
          <span>
            Showing {visible.length} of {leads.length} leads
          </span>
          <Link href="/leads" className="font-medium text-accent hover:underline">
            Clear filters
          </Link>
        </div>
      )}
      {visible.length === 0 ? (
        <EmptyState title="No leads match" message="Try a different search, or clear the filters to see everything." />
      ) : (
        <TableWrap label="Leads">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-edge-soft text-left text-xs uppercase tracking-wide text-ink-3">
                <th scope="col" className="px-3 py-2 font-medium">Client</th>
                <th scope="col" className="px-3 py-2 font-medium">What they want</th>
                <th scope="col" className="px-3 py-2 font-medium">Source</th>
                <th scope="col" className="px-3 py-2 font-medium">Received</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-soft">
              {visible.map((lead) => (
                <tr key={lead.id} className="align-top">
                  <td className="px-3 py-3">
                    <div className="font-medium text-ink">{lead.clientName}</div>
                    {/* Calling a fresh lead back fast is the whole game — these
                        must be one-tap dial/email on a phone, and when a lead has
                        both, show both. */}
                    <div className="flex flex-wrap gap-x-3 text-xs">
                      {lead.contactPhone && (
                        <a href={`tel:${lead.contactPhone.replace(/[^+\d]/g, '')}`} className="text-accent hover:underline">
                          {lead.contactPhone}
                        </a>
                      )}
                      {lead.contactEmail && (
                        <a href={`mailto:${lead.contactEmail}`} className="text-accent hover:underline">
                          {lead.contactEmail}
                        </a>
                      )}
                      {!lead.contactPhone && !lead.contactEmail && (
                        <span className="text-ink-3">No contact info</span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-xs px-3 py-3 text-ink-2">{lead.summary}</td>
                  <td className="px-3 py-3 text-ink-2">{lead.source.replace(/_/g, ' ')}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink-3">{relativeTime(lead.receivedAt)}</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={lead.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
