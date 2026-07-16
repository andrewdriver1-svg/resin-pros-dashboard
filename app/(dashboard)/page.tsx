import Link from 'next/link';
import { Suspense } from 'react';
import { getInvoices, getJobs, getLeads } from '@/lib/db';
import { formatMoney, formatDate, relativeTime } from '@/app/components/format';
import { PageHeader, StatGrid, StatTile, Card, StatusBadge } from '@/app/components/ui';
import { EmptyState, StatGridSkeleton, TableSkeleton } from '@/app/components/states';

export const dynamic = 'force-dynamic';

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description="Where things stand this morning." />
      <Suspense fallback={<StatGridSkeleton />}>
        <Stats />
      </Suspense>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Suspense fallback={<TableSkeleton />}>
          <TodaySchedule />
        </Suspense>
        <Suspense fallback={<TableSkeleton />}>
          <NewLeads />
        </Suspense>
      </div>
    </div>
  );
}

async function Stats() {
  const [jobs, leads, invoices] = await Promise.all([getJobs(), getLeads(), getInvoices()]);
  const active = jobs.filter((j) => j.status === 'in_progress' || j.status === 'scheduled');
  const newLeads = leads.filter((l) => l.status === 'new').length;
  const outstanding = invoices.reduce((sum, i) => sum + Math.max(0, i.amount - i.amountPaid), 0);
  const pipeline = active.reduce((sum, j) => sum + j.value, 0);

  return (
    <StatGrid>
      <StatTile label="New leads" value={String(newLeads)} hint="Awaiting first contact" />
      <StatTile label="Active jobs" value={String(active.length)} hint="Scheduled or in progress" />
      <StatTile label="Pipeline value" value={formatMoney(pipeline)} hint="Active job contracts" />
      <StatTile
        label="Outstanding AR"
        value={formatMoney(outstanding)}
        tone={outstanding > 0 ? 'negative' : 'positive'}
        hint="Unpaid invoice balance"
      />
    </StatGrid>
  );
}

async function TodaySchedule() {
  const jobs = await getJobs();
  const upcoming = jobs
    .filter((j) => j.scheduledAt && (j.status === 'scheduled' || j.status === 'in_progress'))
    .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1))
    .slice(0, 6);

  return (
    <Card title="Job schedule" actions={<Link href="/jobs" className="text-xs font-medium text-sky-700 hover:underline">All jobs →</Link>}>
      {upcoming.length === 0 ? (
        <EmptyState title="Nothing scheduled" message="No active or upcoming jobs on the calendar right now." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {upcoming.map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link href={`/jobs/${job.id}`} className="block truncate text-sm font-medium text-slate-900 hover:underline">
                  {job.title}
                </Link>
                <div className="truncate text-xs text-slate-500">
                  {job.clientName} · {formatDate(job.scheduledAt)}
                </div>
              </div>
              <StatusBadge status={job.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function NewLeads() {
  const leads = await getLeads();
  const recent = leads.slice(0, 6);

  return (
    <Card title="Latest leads" actions={<Link href="/leads" className="text-xs font-medium text-sky-700 hover:underline">All leads →</Link>}>
      {recent.length === 0 ? (
        <EmptyState title="No leads yet" message="New quote requests from Jobber and the website will show up here." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {recent.map((lead) => (
            <li key={lead.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-900">{lead.clientName}</div>
                <div className="truncate text-xs text-slate-500">{lead.summary}</div>
                <div className="mt-0.5 text-xs text-slate-400">
                  {lead.source.replace(/_/g, ' ')} · {relativeTime(lead.receivedAt)}
                </div>
              </div>
              <StatusBadge status={lead.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
