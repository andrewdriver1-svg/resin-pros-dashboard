import Link from 'next/link';
import { Suspense, cache } from 'react';
import { businessConfig } from '@/config/business.config';
import {
  getActivity,
  getAttentionStates,
  getCalendarEvents,
  getInvoices,
  getJobs,
  getLeads,
  getQuotes,
  getQuoteReviews,
  getTasks,
  getTodos,
  getTransactions,
} from '@/lib/db';
import { computeAttention, computeBusinessStatus, computePulse } from '@/lib/insights';
import { buildCalendarItems, itemsForDay, type CalendarItem } from '@/lib/calendar';
import { dayKey, groupTasks, labelTasks, type Task } from '@/lib/tasks';
import { formatMoney, relativeTime } from '@/app/components/format';
import { Card, HealthBadge, StatusBadge } from '@/app/components/ui';
import { EmptyState, TableSkeleton } from '@/app/components/states';
import { TaskItem } from '@/app/components/TaskItem';
import { AttentionList } from '@/app/components/AttentionList';

export const dynamic = 'force-dynamic';

/**
 * TODAY — the daily operating workspace. One screen that answers: what does
 * today look like (schedule + tasks + jobs), what needs attention, and what
 * changed. Personal items appear here and on Calendar but never in business
 * analytics.
 */

const loadAll = cache(async () => {
  const [jobs, quotes, invoices, leads, transactions, todos, tasksRaw, events, activity, attentionStates, quoteReviews] =
    await Promise.all([
      getJobs(),
      getQuotes(),
      getInvoices(),
      getLeads(),
      getTransactions(),
      getTodos(),
      getTasks(),
      getCalendarEvents(),
      getActivity(12),
      getAttentionStates(),
      getQuoteReviews(),
    ]);
  const tasks = labelTasks(tasksRaw, { jobs, quotes, invoices, leads });
  return { jobs, quotes, invoices, leads, transactions, todos, tasks, events, activity, attentionStates, quoteReviews };
});

function greeting(now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: businessConfig.contact.timezone, hour: 'numeric', hour12: false }).format(now),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function TodayPage() {
  const now = new Date();
  const dateLine = new Intl.DateTimeFormat(businessConfig.currency.locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: businessConfig.contact.timezone,
  }).format(now);

  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <div className="space-y-2">
            <div className="h-8 w-56 animate-pulse rounded-lg bg-panel-2" />
          </div>
        }
      >
        <Header dateLine={dateLine} now={now} />
      </Suspense>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Suspense fallback={<TableSkeleton rows={4} />}>
            <TodaySchedule now={now} />
          </Suspense>
          <Suspense fallback={<TableSkeleton rows={5} />}>
            <MyTasks now={now} />
          </Suspense>
          <Suspense fallback={<TableSkeleton rows={4} />}>
            <NeedsAttention now={now} />
          </Suspense>
        </div>

        {/* Intelligence rail — deterministic today; Claude takes this surface over in Phase D. */}
        <div className="space-y-6">
          <Suspense fallback={<TableSkeleton rows={3} />}>
            <NextUp now={now} />
          </Suspense>
          <Suspense fallback={<TableSkeleton rows={3} />}>
            <JobsNow />
          </Suspense>
          <Suspense fallback={<TableSkeleton rows={4} />}>
            <RecentActivity />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

async function Header({ dateLine, now }: { dateLine: string; now: Date }) {
  const data = await loadAll();
  const pulse = computePulse(data, now);
  const status = computeBusinessStatus(pulse);
  const groups = groupTasks(data.tasks, now);
  const todayKeyStr = dayKey(now);
  const eventsToday = data.events.filter((e) => dayKey(e.startsAt) === todayKeyStr).length;
  const activeJobs = data.jobs.filter((j) => j.status === 'in_progress' || j.status === 'scheduled').length;
  const openToday = groups.today.length + groups.overdue.length;

  return (
    <div className="rounded-xl border border-edge bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-ink-4">{dateLine}</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">{greeting(now)}</h1>
          <p className="mt-1 text-sm text-ink-3">
            {openToday} task{openToday === 1 ? '' : 's'} need{openToday === 1 ? 's' : ''} action · {activeJobs} active job
            {activeJobs === 1 ? '' : 's'} · {eventsToday} event{eventsToday === 1 ? '' : 's'} today
          </p>
        </div>
        <div className="max-w-sm rounded-lg border border-edge-soft bg-panel-2/50 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Business status</span>
            <HealthBadge health={status.level} />
          </div>
          <p className="mt-1.5 text-sm leading-snug text-ink-2">{status.detail}</p>
        </div>
      </div>
    </div>
  );
}

const TYPE_DOT: Record<CalendarItem['type'], string> = {
  personal: 'bg-violet-400',
  meeting: 'bg-sky-400',
  business: 'bg-sky-400',
  blocked: 'bg-ink-4',
  reminder: 'bg-warn',
  job: 'bg-good',
  task: 'bg-ink-3',
};

async function TodaySchedule({ now }: { now: Date }) {
  const data = await loadAll();
  const items = itemsForDay(buildCalendarItems(data), dayKey(now));
  const tasksById = Object.fromEntries(data.tasks.map((t) => [t.id, t]));

  return (
    <Card
      title="Today’s schedule"
      actions={
        <Link href="/calendar" className="text-xs font-medium text-accent hover:underline">
          Calendar →
        </Link>
      }
    >
      {items.length === 0 ? (
        <EmptyState title="Open day" message="Nothing on the calendar today. Block time or add an event with +." />
      ) : (
        <ul className="divide-y divide-edge-soft">
          {items.map((i) => {
            if (i.source === 'task') {
              const task = tasksById[i.sourceId];
              if (task) return <li key={i.id} className="py-1"><TaskItem task={task} /></li>;
            }
            const time =
              i.startMin == null
                ? 'All day'
                : `${Math.floor(i.startMin / 60) % 12 === 0 ? 12 : Math.floor(i.startMin / 60) % 12}:${String(i.startMin % 60).padStart(2, '0')} ${i.startMin < 720 ? 'AM' : 'PM'}`;
            return (
              <li key={i.id} className="flex items-center gap-3 py-2.5">
                <span className="w-20 shrink-0 text-xs tabular-nums text-ink-4">{time}</span>
                <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_DOT[i.type]}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">
                    {i.locked && <span aria-hidden>🔒 </span>}
                    {i.title}
                  </span>
                  {i.subtitle && <span className="block truncate text-xs text-ink-4">{i.subtitle}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

async function MyTasks({ now }: { now: Date }) {
  const data = await loadAll();
  const groups = groupTasks(data.tasks, now);
  const list = [...groups.overdue, ...groups.today].slice(0, 8);

  return (
    <Card
      title="My tasks"
      actions={
        <Link href="/todo" className="text-xs font-medium text-accent hover:underline">
          All tasks →
        </Link>
      }
    >
      {list.length === 0 ? (
        <EmptyState title="Clear list" message="Nothing due or overdue. Add a task with + or ⌘K." />
      ) : (
        <div className="-mx-2 divide-y divide-edge-soft/60">
          {list.map((t) => (
            <TaskItem key={t.id} task={t} />
          ))}
        </div>
      )}
    </Card>
  );
}

async function NeedsAttention({ now }: { now: Date }) {
  const data = await loadAll();
  const items = computeAttention(data, now);
  return (
    <Card
      title="Needs attention"
      actions={
        items.length > 0 ? (
          <Link href="/company" className="text-xs font-medium text-accent hover:underline">
            Command Center →
          </Link>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <EmptyState title="All clear" message="No overdue invoices, stale quotes, cold leads, or late materials." />
      ) : (
        <AttentionList items={items} limit={5} />
      )}
    </Card>
  );
}

async function NextUp({ now }: { now: Date }) {
  const data = await loadAll();
  const groups = groupTasks(data.tasks, now);
  const nextTask = [...groups.overdue, ...groups.today][0] ?? groups.upcoming[0] ?? null;
  const attention = computeAttention(data, now).filter((i) => !i.acknowledged)[0] ?? null;
  const schedule = itemsForDay(buildCalendarItems(data), dayKey(now)).filter((i) => i.startMin != null);
  const nowMin = Number(new Intl.DateTimeFormat('en-US', { timeZone: businessConfig.contact.timezone, hour: 'numeric', hour12: false }).format(now)) * 60;
  const nextEvent = schedule.find((i) => (i.startMin ?? 0) >= nowMin) ?? null;

  return (
    <Card title="Next up">
      <div className="space-y-3 text-sm">
        {nextTask ? (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-4">Most urgent task</div>
            <div className="mt-1 text-ink-2">
              {nextTask.title}
              <span className="ml-2 text-xs text-ink-4">{nextTask.entityLabel ?? ''}</span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-ink-4">No open tasks — clean slate.</div>
        )}
        {nextEvent && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-4">Next on the calendar</div>
            <div className="mt-1 text-ink-2">{nextEvent.title}</div>
          </div>
        )}
        {attention && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-4">Biggest open issue</div>
            <div className="mt-1 leading-snug text-ink-2">{attention.title}</div>
          </div>
        )}
        <p className="border-t border-edge-soft pt-2 text-[11px] leading-snug text-ink-4">
          Deterministic for now — Claude takes over this panel in Phase D.
        </p>
      </div>
    </Card>
  );
}

async function JobsNow() {
  const data = await loadAll();
  const active = data.jobs
    .filter((j) => j.status === 'in_progress' || j.status === 'scheduled')
    .sort((a, b) => (a.scheduledAt ?? '9999').localeCompare(b.scheduledAt ?? '9999'))
    .slice(0, 5);
  return (
    <Card
      title="Jobs"
      actions={
        <Link href="/jobs" className="text-xs font-medium text-accent hover:underline">
          All jobs →
        </Link>
      }
    >
      {active.length === 0 ? (
        <EmptyState title="No active jobs" message="Scheduled and in-progress jobs will show here." />
      ) : (
        <ul className="divide-y divide-edge-soft">
          {active.map((j) => (
            <li key={j.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <Link href={`/jobs/${j.id}`} className="block truncate text-sm font-medium text-ink hover:text-accent hover:underline">
                  {j.title}
                </Link>
                <div className="truncate text-xs text-ink-4">
                  {j.clientName} · {formatMoney(j.value)}
                </div>
              </div>
              <StatusBadge status={j.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function RecentActivity() {
  const data = await loadAll();
  return (
    <Card title="Recent activity">
      {data.activity.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-4">Actions you take will show up here.</p>
      ) : (
        <ul className="space-y-2.5">
          {data.activity.slice(0, 8).map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-xs">
              <span
                aria-hidden
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  a.actor === 'human' ? 'bg-accent' : a.actor === 'system' ? 'bg-ink-4' : 'bg-violet-400'
                }`}
              />
              <span className="min-w-0 flex-1 leading-snug text-ink-2">{a.summary}</span>
              <span className="shrink-0 text-ink-4">{relativeTime(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
