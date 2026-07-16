import Link from 'next/link';
import { Suspense } from 'react';
import { getCategory } from '@/config/business.config';
import { getJobCosts, getJobs, getTransactions } from '@/lib/db';
import { rollupByCategory, rollupJobCosts, spendingTotals } from '@/lib/spending';
import { formatMoney, formatDate } from '@/app/components/format';
import { PageHeader, Card, StatGrid, StatTile, TableWrap } from '@/app/components/ui';
import { EmptyState, StatGridSkeleton, TableSkeleton } from '@/app/components/states';
import { CsvImportForm } from '@/app/components/CsvImportForm';

export const dynamic = 'force-dynamic';

export default function SpendingPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Spending" description="Job costs, overhead, and statement imports." />

      <Suspense fallback={<StatGridSkeleton tiles={3} />}>
        <Totals />
      </Suspense>

      <Card title="Import a bank / card statement">
        <p className="mb-4 text-sm text-slate-500">
          Upload a CSV export. Quoted fields, mixed date formats, and both amount sign conventions are
          handled; anything unparseable is reported line-by-line instead of imported blindly.
        </p>
        <CsvImportForm />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Suspense fallback={<TableSkeleton />}>
          <ByCategory />
        </Suspense>
        <Suspense fallback={<TableSkeleton />}>
          <ByJob />
        </Suspense>
      </div>

      <Suspense fallback={<TableSkeleton rows={6} />}>
        <RecentTransactions />
      </Suspense>
    </div>
  );
}

async function Totals() {
  const costs = await getJobCosts();
  const { total, jobCostTotal, overheadTotal } = spendingTotals(costs);
  return (
    <StatGrid>
      <StatTile label="Total tracked spend" value={formatMoney(total)} />
      <StatTile label="Direct job cost" value={formatMoney(jobCostTotal)} hint="Materials, labor, rentals" />
      <StatTile label="Overhead" value={formatMoney(overheadTotal)} hint="Software, insurance, admin" />
    </StatGrid>
  );
}

async function ByCategory() {
  const costs = await getJobCosts();
  const rows = rollupByCategory(costs);
  return (
    <Card title="By category">
      {rows.length === 0 ? (
        <EmptyState title="No spend yet" message="Import a statement or attribute costs to jobs to see this break down." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.categoryId} className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-slate-700">
                {r.label}
                {r.jobCost && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">job cost</span>}
              </span>
              <span className="font-medium text-slate-900">{formatMoney(r.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function ByJob() {
  const [jobs, costs] = await Promise.all([getJobs(), getJobCosts()]);
  const rollups = rollupJobCosts(jobs, costs)
    .filter((r) => r.costCount > 0)
    .sort((a, b) => b.totalCost - a.totalCost);

  return (
    <Card title="Cost by job">
      {rollups.length === 0 ? (
        <EmptyState title="No job costs" message="Costs attributed to jobs will roll up here with margin." />
      ) : (
        <TableWrap>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rollups.map((r) => (
                <tr key={r.jobId}>
                  <td className="px-3 py-2.5">
                    <Link href={`/jobs/${r.jobId}`} className="font-medium text-slate-900 hover:underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700">{formatMoney(r.totalCost)}</td>
                  <td className={`whitespace-nowrap px-3 py-2.5 text-right font-medium ${r.margin >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {formatMoney(r.margin)}
                    {r.marginPct != null && <span className="ml-1 text-xs text-slate-400">({Math.round(r.marginPct * 100)}%)</span>}
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

async function RecentTransactions() {
  const txns = await getTransactions();
  return (
    <Card title="Recent transactions">
      {txns.length === 0 ? (
        <EmptyState title="No transactions" message="Imported statement lines will appear here." />
      ) : (
        <TableWrap>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {txns.map((t) => (
                <tr key={t.id}>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatDate(t.date)}</td>
                  <td className="px-3 py-2.5 text-slate-800">{t.description}</td>
                  <td className="px-3 py-2.5 text-slate-600">{getCategory(t.categoryId).label}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium text-slate-900">{formatMoney(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
