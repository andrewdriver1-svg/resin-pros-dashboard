import { Suspense } from 'react';
import Link from 'next/link';
import { getCustomers, getInvoices, getJobs, getLeads, getQuotes } from '@/lib/db';
import { invoiceBalance } from '@/lib/insights';
import { formatMoney } from '@/app/components/format';
import { Card, PageHeader } from '@/app/components/ui';
import { EmptyState, TableSkeleton } from '@/app/components/states';

export const dynamic = 'force-dynamic';

/**
 * Customers — the first relationship view in the OS. One row per real client,
 * keyed on Jobber's stable client id (populated by the sync; run a sync if the
 * list looks thin). Aggregates are computed from already-synced records; no
 * profitability is invented.
 */
export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Customers" description="Every client relationship — leads, quotes, jobs, invoices, and your internal notes in one place." />
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <CustomerTable />
      </Suspense>
    </div>
  );
}

async function CustomerTable() {
  const [customers, jobs, quotes, invoices, leads] = await Promise.all([
    getCustomers(),
    getJobs(),
    getQuotes(),
    getInvoices(),
    getLeads(),
  ]);

  if (customers.length === 0) {
    return (
      <EmptyState
        title="No customers yet"
        message="Customers appear after the next Jobber sync (Settings → Jobber → Sync now)."
      />
    );
  }

  const rows = customers
    .map((c) => {
      const cJobs = jobs.filter((j) => j.jobberClientId === c.jobberClientId);
      const cQuotes = quotes.filter((q) => q.jobberClientId === c.jobberClientId);
      const cInvoices = invoices.filter((i) => i.jobberClientId === c.jobberClientId);
      const cLeads = leads.filter((l) => l.jobberClientId === c.jobberClientId);
      const openQuoteValue = cQuotes.filter((q) => q.status === 'awaiting_response').reduce((s, q) => s + q.amount, 0);
      const ar = cInvoices.reduce((s, i) => s + invoiceBalance(i), 0);
      const lifetime = cInvoices.reduce((s, i) => s + i.amountPaid, 0);
      return { c, jobs: cJobs.length, quotes: cQuotes.length, openQuoteValue, ar, lifetime, leads: cLeads.length };
    })
    .sort((a, b) => b.openQuoteValue + b.ar - (a.openQuoteValue + a.ar) || b.lifetime - a.lifetime);

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge-soft text-left text-xs uppercase tracking-wide text-ink-4">
              <th className="pb-2 pr-4 font-medium">Customer</th>
              <th className="pb-2 pr-4 font-medium">Jobs</th>
              <th className="pb-2 pr-4 font-medium">Quotes</th>
              <th className="pb-2 pr-4 font-medium text-right">Open quote value</th>
              <th className="pb-2 pr-4 font-medium text-right">Outstanding AR</th>
              <th className="pb-2 font-medium text-right">Collected to date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, jobs: jn, quotes: qn, openQuoteValue, ar, lifetime }) => (
              <tr key={c.id} className="border-b border-edge-soft/60 last:border-0 hover:bg-panel-2/40">
                <td className="py-2.5 pr-4">
                  <Link href={`/customers/${c.id}`} className="font-medium text-ink hover:text-accent">
                    {c.name}
                  </Link>
                  {(c.email || c.phone) && <div className="text-xs text-ink-4">{[c.email, c.phone].filter(Boolean).join(' · ')}</div>}
                </td>
                <td className="py-2.5 pr-4 text-ink-2">{jn || '—'}</td>
                <td className="py-2.5 pr-4 text-ink-2">{qn || '—'}</td>
                <td className="py-2.5 pr-4 text-right text-ink-2">{openQuoteValue ? formatMoney(openQuoteValue) : '—'}</td>
                <td className={`py-2.5 pr-4 text-right ${ar > 0 ? 'font-medium text-warn' : 'text-ink-4'}`}>{ar ? formatMoney(ar) : '—'}</td>
                <td className="py-2.5 text-right text-ink-2">{lifetime ? formatMoney(lifetime) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
