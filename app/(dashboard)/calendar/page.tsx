import Link from 'next/link';
import { Suspense } from 'react';
import { businessConfig } from '@/config/business.config';
import { getCalendarEvents, getInvoices, getJobs, getLeads, getQuotes, getTasks } from '@/lib/db';
import { buildCalendarItems, itemsForDay, monthGrid, shiftDay, weekDayKeys, type CalendarItem } from '@/lib/calendar';
import { dayKey, labelTasks, type Task } from '@/lib/tasks';
import { PageHeader, Card } from '@/app/components/ui';
import { TableSkeleton } from '@/app/components/states';
import { CalendarWeek } from '@/app/components/CalendarWeek';
import { TaskItem } from '@/app/components/TaskItem';
import { NewEventButton } from './new-event-button';

export const dynamic = 'force-dynamic';

/**
 * Calendar — one operating calendar over three sources: internal events,
 * dated tasks (the same Task objects as To Do), and Jobber job scheduling
 * (read-only from here, always). Views: month / week / day.
 */
type Params = { view?: string; date?: string };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const view = params.view === 'month' || params.view === 'day' ? params.view : 'week';
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : dayKey(new Date());

  return (
    <div className="space-y-6">
      <PageHeader title="Calendar" description="Personal and business commitments, one schedule." actions={<NewEventButton />} />
      <ViewBar view={view} anchor={anchor} />
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <CalendarBody view={view} anchor={anchor} />
      </Suspense>
    </div>
  );
}

function ViewBar({ view, anchor }: { view: string; anchor: string }) {
  const step = view === 'month' ? 31 : view === 'week' ? 7 : 1;
  const label =
    view === 'month'
      ? new Intl.DateTimeFormat(businessConfig.currency.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${anchor}T12:00:00Z`))
      : new Intl.DateTimeFormat(businessConfig.currency.locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${anchor}T12:00:00Z`));

  const chip = (v: string, l: string) => (
    <Link
      key={v}
      href={`/calendar?view=${v}&date=${anchor}`}
      aria-current={view === v ? 'true' : undefined}
      className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium transition ${
        view === v ? 'border-accent bg-accent text-surface' : 'border-edge bg-panel text-ink-2 hover:border-accent/50 hover:text-ink'
      }`}
    >
      {l}
    </Link>
  );

  const navBtn = 'flex h-9 w-9 items-center justify-center rounded-lg border border-edge text-ink-2 hover:border-accent/50 hover:text-accent';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {chip('month', 'Month')}
        {chip('week', 'Week')}
        {chip('day', 'Day')}
      </div>
      <div className="flex items-center gap-2">
        <Link href={`/calendar?view=${view}&date=${shiftDay(anchor, -step)}`} aria-label="Previous" className={navBtn}>
          ‹
        </Link>
        <span className="min-w-36 text-center text-sm font-medium text-ink">{label}</span>
        <Link href={`/calendar?view=${view}&date=${shiftDay(anchor, step)}`} aria-label="Next" className={navBtn}>
          ›
        </Link>
        <Link href={`/calendar?view=${view}&date=${dayKey(new Date())}`} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-2 hover:border-accent/50 hover:text-accent">
          Today
        </Link>
      </div>
    </div>
  );
}

async function loadItems(): Promise<{ items: CalendarItem[]; tasksById: Record<string, Task> }> {
  const [events, tasksRaw, jobs, quotes, invoices, leads] = await Promise.all([
    getCalendarEvents(),
    getTasks(),
    getJobs(),
    getQuotes(),
    getInvoices(),
    getLeads(),
  ]);
  const tasks = labelTasks(tasksRaw, { jobs, quotes, invoices, leads });
  const items = buildCalendarItems({ events, tasks, jobs });
  const tasksById = Object.fromEntries(tasks.map((t) => [t.id, t]));
  return { items, tasksById };
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

async function CalendarBody({ view, anchor }: { view: string; anchor: string }) {
  const { items, tasksById } = await loadItems();
  const todayKey = dayKey(new Date());

  if (view === 'week') {
    return (
      <Card>
        <CalendarWeek days={weekDayKeys(anchor)} items={items} tasksById={tasksById} todayKey={todayKey} />
      </Card>
    );
  }

  if (view === 'day') {
    const dayItems = itemsForDay(items, anchor);
    const timed = dayItems.filter((i) => i.startMin != null);
    const allDay = dayItems.filter((i) => i.startMin == null);
    return (
      <Card title={anchor === todayKey ? 'Today' : undefined}>
        {dayItems.length === 0 && <p className="py-6 text-center text-sm text-ink-3">Nothing scheduled.</p>}
        <ul className="divide-y divide-edge-soft">
          {allDay.map((i) => (
            <DayRow key={i.id} item={i} tasksById={tasksById} time="All day" />
          ))}
          {timed.map((i) => (
            <DayRow
              key={i.id}
              item={i}
              tasksById={tasksById}
              time={`${Math.floor(i.startMin! / 60) % 12 === 0 ? 12 : Math.floor(i.startMin! / 60) % 12}:${String(i.startMin! % 60).padStart(2, '0')} ${i.startMin! < 720 ? 'AM' : 'PM'}`}
            />
          ))}
        </ul>
      </Card>
    );
  }

  // month
  const grid = monthGrid(anchor);
  return (
    <Card>
      <div className="table-scroll overflow-x-auto">
        <div className="min-w-[46rem]">
          <div className="grid grid-cols-7 text-center text-xs font-medium text-ink-4">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="pb-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-edge-soft">
            {grid.weeks.flat().map((k) => {
              const inMonth = Number(k.slice(5, 7)) === grid.month;
              const dayItems = itemsForDay(items, k);
              return (
                <Link
                  key={k}
                  href={`/calendar?view=day&date=${k}`}
                  className={`block min-h-24 bg-panel p-1.5 transition-colors hover:bg-panel-2/60 ${inMonth ? '' : 'opacity-40'}`}
                >
                  <span className={`text-xs tabular-nums ${k === todayKey ? 'rounded bg-accent px-1 font-semibold text-surface' : 'text-ink-3'}`}>
                    {Number(k.slice(8))}
                  </span>
                  <div className="mt-1 space-y-0.5">
                    {dayItems.slice(0, 3).map((i) => (
                      <div key={i.id} className={`flex items-center gap-1 truncate text-[10px] leading-tight ${i.done ? 'line-through opacity-50' : ''} text-ink-2`}>
                        <span aria-hidden className={`h-1 w-1 shrink-0 rounded-full ${TYPE_DOT[i.type]}`} />
                        <span className="truncate">{i.title}</span>
                      </div>
                    ))}
                    {dayItems.length > 3 && <div className="text-[10px] text-ink-4">+{dayItems.length - 3} more</div>}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
      <p className="mt-3 flex flex-wrap gap-3 text-[11px] text-ink-4">
        <span className="flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${TYPE_DOT.job}`} /> Job</span>
        <span className="flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${TYPE_DOT.task}`} /> Task</span>
        <span className="flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${TYPE_DOT.meeting}`} /> Meeting / business</span>
        <span className="flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${TYPE_DOT.personal}`} /> Personal</span>
        <span className="flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${TYPE_DOT.reminder}`} /> Reminder</span>
      </p>
    </Card>
  );
}

function DayRow({ item, tasksById, time }: { item: CalendarItem; tasksById: Record<string, Task>; time: string }) {
  if (item.source === 'task') {
    const task = tasksById[item.sourceId];
    if (task) {
      return (
        <li className="py-1">
          <TaskItem task={task} />
        </li>
      );
    }
  }
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="w-20 shrink-0 text-xs tabular-nums text-ink-4">{time}</span>
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${TYPE_DOT[item.type]}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">
          {item.locked && <span aria-hidden>🔒 </span>}
          {item.title}
        </span>
        {item.subtitle && <span className="block truncate text-xs text-ink-4">{item.subtitle}</span>}
      </span>
    </li>
  );
}
