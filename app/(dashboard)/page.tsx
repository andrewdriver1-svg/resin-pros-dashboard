import Link from 'next/link';
import { Suspense, cache } from 'react';
import { businessConfig } from '@/config/business.config';
import { getInvoices, getJobs, getLeads, getQuotes, getTodos, getTransactions } from '@/lib/db';
import { computeAttention, computeKpis, computePulse } from '@/lib/insights';
import { formatMoney, formatDateTime, relativeTime } from '@/app/components/format';
import { Card, Delta, HealthBadge, StatGrid, StatTile, StatusBadge } from '@/app/components/ui';
import { EmptyState, StatGridSkeleton, TableSkeleton } from '@/app/components/states';

export const dynamic = 'force-dynamic';

/** Greeting in the business timezone — Vercel runs UTC. */
function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: businessConfig.contact.timezone,
      hour: 'numeric',
      hour12: false,
    }).format(now),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function CommandCenterPage() {
  const now = new Date();
  const dateLine = new Intl.DateTimeFormat(businessConfig.currency.locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: businessConfig.contact.timezone,
  }).format(now);

  return (
    <div className="space-y-6">
      <div className="mb-2">
        <div className="text-xs font-medium uppercase tracking-wider text-ink-4">{dateLine}</div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">{greeting(now)}</h1>
        <p className="mt-1 text-sm text-ink-3">What&apos;s happening, what needs attention, and what to do next.</p>
      </div>

      <Suspense fallback={<StatGridSkeleton tiles={6} />}>
        <HeroKpis />
      </Suspense>

      <Suspense fallback={<TableSkeleton rows={2} />}>
        <BusinessPulse />
      </Suspense>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Suspense fallback={<TableSkeleton rows={5} />}>
            <AttentionCenter />
          </Suspense>
        </div>
        <div className="space-y-6">
          <Suspense fallback={<TableSkeleton rows={4} />}>
            <TodaySchedule />
          </Suspense>
          <Suspense fallback={<TableSkeleton rows={4} />}>
            <NewLeads />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/** One set of reads per request — the three sections below share it (React cache). */
const loadAll = cache(async () => {
  const [jobs, quotes, invoices, leads, transactions, todos] = await Promise.all([
    getJobs(),
    getQuotes(),
    getInvoices(),
    getLeads(),
    getTransactions(),
    getTodos(),
  ]);
  return { jobs, quotes, invoices, leads, transactions, todos };
});

async function HeroKpis() {
  const data = await loadAll();
  const k = computeKpis(data);

  const paceDelta =
    k.invoicedPrevPace > 0 ? (
      <Delta
        label={`${k.invoicedMtd >= k.invoicedPrevPace ? '+' : '−'}${Math.round(
          (Math.abs(k.invoicedMtd - k.invoicedPrevPace) / k.invoicedPrevPace) * 100,
        )}% vs last mo.`}
        good={k.invoicedMtd >= k.invoicedPrevPace}
      />
    ) : undefined;

  return (
    <StatGrid cols={6}>
      <StatTile label="Invoiced MTD" value={formatMoney(k.invoicedMtd)} delta={paceDelta} hint={paceDelta ? undefined : 'Billed this month'} />
      <StatTile label="Invoiced YTD" value={formatMoney(k.invoicedYtd)} hint="Billed this year" />
      <StatTile
        label="Open pipeline"
        value={formatMoney(k.pipelineValue)}
        hint={`${k.pipelineCount} quote${k.pipelineCount === 1 ? '' : 's'} awaiting answer`}
      />
      <StatTile label="Weighted pipeline" value={formatMoney(k.weightedPipeline)} hint="At 40% close odds" />
      <StatTile
        label="Outstanding AR"
        value={formatMoney(k.arOutstanding)}
        tone={k.arOverdue > 0 ? 'negative' : 'default'}
        hint={k.arOverdue > 0 ? `${formatMoney(k.arOverdue)} overdue` : 'Nothing overdue'}
      />
      <StatTile
        label="Active jobs"
        value={String(k.activeJobs)}
        hint={`${formatMoney(k.activeJobsValue)} under contract`}
      />
    </StatGrid>
  );
}

async function BusinessPulse() {
  const data = await loadAll();
  const signals = computePulse(data);

  return (
    <Card title="Business Pulse">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {signals.map((s) => (
          <div key={s.key} className="rounded-lg border border-edge-soft bg-panel-2/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">{s.label}</div>
              <HealthBadge health={s.health} />
            </div>
            <p className="mt-1.5 text-sm leading-snug text-ink-2">{s.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

async function AttentionCenter() {
  const data = await loadAll();
  const items = computeAttention(data);
  const shown = items.slice(0, 8);
  const extra = items.length - shown.length;

  return (
    <Card
      title="Needs attention"
      actions={
        items.length > 0 ? (
          <span className="text-xs font-medium text-ink-4">
            {items.length} item{items.length === 1 ? '' : 's'}
          </span>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <EmptyState
          title="All clear"
          message="No overdue invoices, stale quotes, cold leads, or late materials. Keep it that way."
        />
      ) : (
        <ul className="divide-y divide-edge-soft">
          {shown.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-4 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    item.severity === 'high' ? 'bg-bad' : 'bg-warn'
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">
                    {item.title}
                    <span className="sr-only">{item.severity === 'high' ? ' (high priority)' : ''}</span>
                  </div>
                  <div className="mt-0.5 text-xs leading-snug text-ink-3">{item.detail}</div>
                </div>
              </div>
              <Link
                href={item.href}
                className="shrink-0 rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors duration-150 hover:border-accent/50 hover:text-accent"
              >
                {item.linkLabel}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {extra > 0 && <div className="pt-3 text-xs text-ink-4">+{extra} more lower-priority items</div>}
    </Card>
  );
}

async function TodaySchedule() {
  const jobs = await getJobs();
  // Date floor: a job someone forgot to close out months ago is a bookkeeping
  // problem, not a schedule.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const upcoming = jobs
    .filter(
      (j) =>
        j.scheduledAt &&
        (j.status === 'scheduled' || j.status === 'in_progress') &&
        new Date(j.scheduledAt).getTime() >= cutoff,
    )
    .sort((a, b) => (a.scheduledAt! < b.scheduledAt! ? -1 : 1))
    .slice(0, 6);

  return (
    <Card
      title="Job schedule"
      actions={
        <Link href="/jobs" className="text-xs font-medium text-accent hover:underline">
          All jobs →
        </Link>
      }
    >
      {upcoming.length === 0 ? (
        <EmptyState title="Nothing scheduled" message="No active or upcoming jobs on the calendar right now." />
      ) : (
        <ul className="divide-y divide-edge-soft">
          {upcoming.map((job) => (
            <li key={job.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link href={`/jobs/${job.id}`} className="block truncate text-sm font-medium text-ink hover:text-accent hover:underline">
                  {job.title}
                </Link>
                <div className="truncate text-xs text-ink-3">
                  {job.clientName} · {formatDateTime(job.scheduledAt)}
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
    <Card
      title="Latest leads"
      actions={
        <Link href="/leads" className="text-xs font-medium text-accent hover:underline">
          All leads →
        </Link>
      }
    >
      {recent.length === 0 ? (
        <EmptyState title="No leads yet" message="New quote requests from Jobber and the website will show up here." />
      ) : (
        <ul className="divide-y divide-edge-soft">
          {recent.map((lead) => (
            <li key={lead.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{lead.clientName}</div>
                <div className="truncate text-xs text-ink-3">{lead.summary}</div>
                <div className="mt-0.5 text-xs text-ink-4">
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
