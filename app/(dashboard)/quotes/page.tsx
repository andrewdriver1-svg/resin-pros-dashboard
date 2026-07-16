import Link from 'next/link';
import { Suspense } from 'react';
import { getInvoices, getQuotes } from '@/lib/db';
import { formatMoney, formatDate } from '@/app/components/format';
import { PageHeader, Card, StatGrid, StatTile, StatusBadge, TableWrap } from '@/app/components/ui';
import { EmptyState, StatGridSkeleton, TableSkeleton } from '@/app/components/states';

export const dynamic = 'force-dynamic';

export default function QuotesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Quotes & Invoices" description="Outstanding proposals and receivables." />
      <Suspense fallback={<StatGridSkeleton tiles={3} />}>
        <MoneyStats />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <Quotes />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <Invoices />
      </Suspense>
    </div>
  );
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
  if (!jobId) return <span className="text-slate-400">—</span>;
  return (
    <Link href={`/jobs/${jobId}`} className="text-sky-700 hover:underline">
      {children}
    </Link>
  );
}

async function Quotes() {
  const quotes = await getQuotes();
  return (
    <Card title="Quotes">
      {quotes.length === 0 ? (
        <EmptyState title="No quotes" message="Quotes created in Jobber will sync in here." />
      ) : (
        <TableWrap>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Quote</th>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quotes.map((q) => (
                <tr key={q.id}>
                  <td className="px-3 py-2.5 font-medium text-slate-900">{q.number}</td>
                  <td className="px-3 py-2.5 text-slate-600">{q.clientName}</td>
                  <td className="px-3 py-2.5"><JobLink jobId={q.jobId}>View</JobLink></td>
                  <td className="px-3 py-2.5"><StatusBadge status={q.status} /></td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium text-slate-900">{formatMoney(q.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

async function Invoices() {
  const invoices = await getInvoices();
  return (
    <Card title="Invoices">
      {invoices.length === 0 ? (
        <EmptyState title="No invoices" message="Invoices created in Jobber will sync in here." />
      ) : (
        <TableWrap>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Invoice</th>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">Due</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => {
                const balance = Math.max(0, inv.amount - inv.amountPaid);
                return (
                  <tr key={inv.id}>
                    <td className="px-3 py-2.5 font-medium text-slate-900">{inv.number}</td>
                    <td className="px-3 py-2.5 text-slate-600">{inv.clientName}</td>
                    <td className="px-3 py-2.5"><JobLink jobId={inv.jobId}>View</JobLink></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatDate(inv.dueAt)}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={inv.status} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium text-slate-900">{formatMoney(balance)}</td>
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
