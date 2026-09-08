import Link from 'next/link';
import { Suspense } from 'react';
import { getJobs } from '@/lib/db';
import type { Job } from '@/lib/db/types';
import { formatMoney, formatDate, humanizeStatus } from '@/app/components/format';
import { PageHeader, Card, StatusBadge, TableWrap } from '@/app/components/ui';
import { EmptyState, TableSkeleton } from '@/app/components/states';

export const dynamic = 'force-dynamic';

/** Status filter chips, in workflow order. 'all' is the absence of a filter. */
const STATUS_FILTERS = ['scheduled', 'in_progress', 'complete', 'invoiced'] as const;

type Filters = { q?: string; status?: string };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams;
  return (
    <div className="space-y-6">
      <PageHeader title="Jobs" description="Every job, synced from Jobber." />
      <FilterBar filters={filters} />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <JobsTable filters={filters} />
      </Suspense>
    </div>
  );
}

function chipHref(filters: Filters, status?: string): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (status) params.set('status', status);
  const qs = params.toString();
  return qs ? `/jobs?${qs}` : '/jobs';
}

function FilterBar({ filters }: { filters: Filters }) {
  const active = filters.status ?? '';
  const chip = (label: string, value?: string) => {
    const isActive = (value ?? '') === active;
    return (
      <Link
        key={label}
        href={chipHref(filters, value)}
        className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium transition ${
          isActive
            ? 'border-accent bg-accent text-surface'
            : 'border-edge bg-panel text-ink-2 hover:border-accent/50 hover:text-ink'
        }`}
        aria-current={isActive ? 'true' : undefined}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {chip('All')}
        {STATUS_FILTERS.map((s) => chip(humanizeStatus(s), s))}
      </div>
      {/* Plain GET form: the URL is the state, so a filtered view is
          shareable and the back button works. */}
      <form action="/jobs" className="flex items-center gap-2">
        {filters.status && <input type="hidden" name="status" value={filters.status} />}
        <input
          type="search"
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder="Search job, client, address…"
          aria-label="Search jobs"
          className="w-full rounded-lg border border-edge bg-panel px-3 py-2 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:ring-1 focus:ring-accent sm:w-64"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-surface transition hover:bg-accent-soft"
        >
          Search
        </button>
      </form>
    </div>
  );
}

/**
 * Sort for the daily question, "what's next?": active work (scheduled /
 * in progress) first, soonest date at the top; then everything else newest
 * first; unscheduled jobs sink within their group instead of pinning to the
 * top the way a raw NULLS-FIRST database sort left them.
 */
function compareJobs(a: Job, b: Job): number {
  const activeStatuses = new Set(['scheduled', 'in_progress']);
  const aActive = activeStatuses.has(a.status) ? 0 : 1;
  const bActive = activeStatuses.has(b.status) ? 0 : 1;
  if (aActive !== bActive) return aActive - bActive;
  const aDate = a.scheduledAt ?? '';
  const bDate = b.scheduledAt ?? '';
  if (aActive === 0) {
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate < bDate ? -1 : 1; // soonest first
  }
  return aDate > bDate ? -1 : 1; // most recent first
}

async function JobsTable({ filters }: { filters: Filters }) {
  const jobs = await getJobs();

  if (jobs.length === 0) {
    return (
      <EmptyState
        title="No jobs yet"
        message="Once Jobber is connected (Settings → Connect Jobber) your jobs will sync in automatically."
      />
    );
  }

  const q = (filters.q ?? '').trim().toLowerCase();
  const visible = jobs
    .filter((job) => !filters.status || job.status === filters.status)
    .filter(
      (job) =>
        !q ||
        job.title.toLowerCase().includes(q) ||
        job.clientName.toLowerCase().includes(q) ||
        (job.address ?? '').toLowerCase().includes(q),
    )
    .sort(compareJobs);

  const filtered = Boolean(q || filters.status);

  return (
    <Card>
      {filtered && (
        <div className="mb-3 flex items-center justify-between text-xs text-ink-3">
          <span>
            Showing {visible.length} of {jobs.length} jobs
          </span>
          <Link href="/jobs" className="font-medium text-accent hover:underline">
            Clear filters
          </Link>
        </div>
      )}
      {visible.length === 0 ? (
        <EmptyState
          title="No jobs match"
          message="Try a different search, or clear the filters to see everything."
          action={
            <Link href="/jobs" className="text-sm font-medium text-accent hover:underline">
              Clear filters
            </Link>
          }
        />
      ) : (
        <TableWrap label="Jobs">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-edge-soft text-left text-xs uppercase tracking-wide text-ink-3">
                <th scope="col" className="px-3 py-2 font-medium">
                  Job
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Client
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Scheduled
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-soft">
              {visible.map((job) => (
                <tr key={job.id} className="hover:bg-panel-2">
                  <td className="px-3 py-3">
                    {/* Sky, not body-black: on a phone there is no hover, so a
                        link has to look like one before it's touched. */}
                    <Link href={`/jobs/${job.id}`} className="font-medium text-accent hover:underline">
                      {job.title}
                    </Link>
                    {job.address && (
                      <div className="text-xs">
                        {/* The address exists to be driven to. */}
                        <a
                          href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-ink-3 underline decoration-edge underline-offset-2 hover:text-accent"
                        >
                          {job.address}
                        </a>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-ink-2">{job.clientName}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink-2">{formatDate(job.scheduledAt)}</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums text-ink">
                    {formatMoney(job.value)}
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
