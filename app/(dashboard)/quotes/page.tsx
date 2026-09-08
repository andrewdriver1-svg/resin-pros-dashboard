import Link from 'next/link';
import { Suspense } from 'react';
import { getInvoices, getQuotes } from '@/lib/db';
import { isOverdue } from '@/lib/insights';
import { formatMoney, formatDate } from '@/app/components/format';
import { PageHeader, Card, StatGrid, StatTile, StatusBadge, TableWrap } from '@/app/components/ui';
import { EmptyState, StatGridSkeleton, TableSkeleton } from '@/app/components/states';

export const dynamic = 'force-dynamic';

/**
 * Read-only deep-link filters, used by the ⌘K palette and the Attention
 * Center:  ?q=<text> matches number/client on both tables;
 * ?view=overdue narrows invoices to past-due balances;
 * ?view=stale narrows quotes to 7+ days with no answer.
 */
type Filters = { q?: string; view?: string };

const DAY_MS = 86_400_000;

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams;
  return (
    <div className="space-y-6">
      <PageHeader title="Quotes & Invoices" description="Outstanding proposals and receivables." />
      <Suspense fallback={<StatGridSkeleton tiles={3} />}>
        <MoneyStats />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <Quotes filters={filters} />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <Invoices filters={filters} />
      </Suspense>
    </div>
  );
}

function FilterBanner({ shown, total, label }: { shown: number; total: number; label: string }) {
  return (
    <div className="mb-3 flex items-center justify-between text-xs text-ink-3">
      <span>
        Showing {shown} of {total} {label}
      </span>
      <Link href="/quotes" className="font-medium text-accent hover:underline">
        Clear filters
      </Link>
    </div>
  );
}

function matchesQ(q: string, ...fields: (string | undefined)[]): boolean {
  const needle = q.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

async function MoneyStats() {
  const [quotes, invoices] = await Promise.all([getQuotes(), getInvoices()]);
  const openQuotes = quotes.filter((q) => q.status === 'awaiting_response' || q.status === 'draft');
  const openQuoteValue = openQuotes.reduce((s, q) => s + q.amount, 0);
  const outstanding = invoices.reduce((s, i) => s + Math.max(0, i.amount - i.amountPaid), 0);
  const pastDue = invoices.filter((i) => i.status === 'past_due').reduce((s, i) => s + Math.max(0, i.amount - i.amountPaid), 0);

  return (
    <StatGrid>
      <StatTile label="Open quotes" value={formatMoney(openQuoteValue)} hint={`${openQuotes.length} awaiting response`} />
      <StatTile label="Outstanding AR" value={formatMoney(outstanding)} tone={outstanding > 0 ? 'negative' : 'positive'} />
      <StatTile label="Past due" value={formatMoney(pastDue)} tone={pastDue > 0 ? 'negative' : 'positive'} />
    </StatGrid>
  );
}

function JobLink({ jobId, children }: { jobId?: string; children: React.ReactNode }) {
  if (!jobId) return <span className="text-ink-4">—</span>;
  return (
    <Link href={`/jobs/${jobId}`} className="text-accent hover:underline">
      {children}
    </Link>
  );
}

async function Quotes({ filters }: { filters: Filters }) {
  const quotes = await getQuotes();
  const q = (filters.q ?? '').trim();
  const staleCutoff = Date.now() - 7 * DAY_MS;
  const visible = quotes
    .filter((quote) => !q || matchesQ(q, quote.number, quote.clientName))
    .filter(
      (quote) =>
        filters.view !== 'stale' ||
        (quote.status === 'awaiting_response' && quote.issuedAt != null && new Date(quote.issuedAt).getTime() < staleCutoff),
    );
  const filtered = Boolean(q || filters.view === 'stale');

  return (
    <Card title={filters.view === 'stale' ? 'Stale quotes (7+ days, no answer)' : 'Quotes'}>
      {filtered && <FilterBanner shown={visible.length} total={quotes.length} label="quotes" />}
      {visible.length === 0 ? (
        <EmptyState
          title={filtered ? 'No quotes match' : 'No quotes'}
          message={filtered ? 'Try a different search, or clear the filters.' : 'Quotes created in Jobber will sync in here.'}
        />
      ) : (
        <TableWrap label="Quotes">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-edge-soft text-left text-xs uppercase tracking-wide text-ink-3">
                <th scope="col" className="px-3 py-2 font-medium">Quote</th>
                <th scope="col" className="px-3 py-2 font-medium">Client</th>
                <th scope="col" className="px-3 py-2 font-medium">Issued</th>
                <th scope="col" className="px-3 py-2 font-medium">Job</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-soft">
              {visible.map((quote) => (
                <tr key={quote.id}>
                  <td className="px-3 py-2.5 font-medium text-ink">{quote.number}</td>
                  <td className="px-3 py-2.5 text-ink-2">{quote.clientName}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-3">{formatDate(quote.issuedAt)}</td>
                  <td className="px-3 py-2.5"><JobLink jobId={quote.jobId}>View</JobLink></td>
                  <td className="px-3 py-2.5"><StatusBadge status={quote.status} /></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums text-ink">{formatMoney(quote.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

async function Invoices({ filters }: { filters: Filters }) {
  const invoices = await getInvoices();
  const q = (filters.q ?? '').trim();
  const now = Date.now();
  const visible = invoices
    .filter((inv) => !q || matchesQ(q, inv.number, inv.clientName))
    .filter((inv) => filters.view !== 'overdue' || isOverdue(inv, now));
  const filtered = Boolean(q || filters.view === 'overdue');

  return (
    <Card title={filters.view === 'overdue' ? 'Overdue invoices' : 'Invoices'}>
      {filtered && <FilterBanner shown={visible.length} total={invoices.length} label="invoices" />}
      {visible.length === 0 ? (
        <EmptyState
          title={filtered ? 'No invoices match' : 'No invoices'}
          message={filtered ? 'Try a different search, or clear the filters.' : 'Invoices created in Jobber will sync in here.'}
        />
      ) : (
        <TableWrap label="Invoices">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-edge-soft text-left text-xs uppercase tracking-wide text-ink-3">
                <th scope="col" className="px-3 py-2 font-medium">Invoice</th>
                <th scope="col" className="px-3 py-2 font-medium">Client</th>
                <th scope="col" className="px-3 py-2 font-medium">Job</th>
                <th scope="col" className="px-3 py-2 font-medium">Due</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-soft">
              {visible.map((inv) => {
                const balance = Math.max(0, inv.amount - inv.amountPaid);
                return (
                  <tr key={inv.id}>
                    <td className="px-3 py-2.5 font-medium text-ink">{inv.number}</td>
                    <td className="px-3 py-2.5 text-ink-2">{inv.clientName}</td>
                    <td className="px-3 py-2.5"><JobLink jobId={inv.jobId}>View</JobLink></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{formatDate(inv.dueAt)}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={inv.status} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums text-ink">{formatMoney(balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
