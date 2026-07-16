import Link from 'next/link';
import { Suspense } from 'react';
import { getJobs } from '@/lib/db';
import { formatMoney, formatDate } from '@/app/components/format';
import { PageHeader, Card, StatusBadge, TableWrap } from '@/app/components/ui';
import { EmptyState, TableSkeleton } from '@/app/components/states';

export const dynamic = 'force-dynamic';

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Jobs" description="Every job, synced from Jobber." />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <JobsTable />
      </Suspense>
    </div>
  );
}

async function JobsTable() {
  const jobs = await getJobs();

  if (jobs.length === 0) {
    return (
      <EmptyState
        title="No jobs yet"
        message="Once Jobber is connected (Settings → Connect Jobber) your jobs will sync in automatically."
      />
    );
  }

  return (
    <Card>
      <TableWrap>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium">Scheduled</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-slate-50">
                <td className="px-3 py-3">
                  <Link href={`/jobs/${job.id}`} className="font-medium text-slate-900 hover:underline">
                    {job.title}
                  </Link>
                  {job.address && <div className="text-xs text-slate-500">{job.address}</div>}
                </td>
                <td className="px-3 py-3 text-slate-600">{job.clientName}</td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-600">{formatDate(job.scheduledAt)}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={job.status} />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-medium text-slate-900">
                  {formatMoney(job.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}
