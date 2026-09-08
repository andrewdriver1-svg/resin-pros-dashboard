import Link from 'next/link';
import { Suspense } from 'react';
import { getInvoices, getJobs, getLeads, getQuotes, getTasks } from '@/lib/db';
import { groupTasks, labelTasks, type Task } from '@/lib/tasks';
import { PageHeader, Card } from '@/app/components/ui';
import { EmptyState, TableSkeleton } from '@/app/components/states';
import { TaskItem } from '@/app/components/TaskItem';
import { NewTaskButton } from './new-task-button';

export const dynamic = 'force-dynamic';

/**
 * To Do — the personal + business task list. Default view emphasizes what
 * needs action; completed work collapses at the bottom instead of vanishing.
 * Filters: ?filter=standalone|job|today|overdue, ?priority=high|urgent.
 */
type Filters = { filter?: string; priority?: string };

export default async function TodoPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams;
  return (
    <div className="space-y-6">
      <PageHeader
        title="To Do"
        description="Standalone to-dos and job tasks, one list."
        actions={<NewTaskButton />}
      />
      <FilterBar filters={filters} />
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <TaskSections filters={filters} />
      </Suspense>
    </div>
  );
}

const FILTERS: { key: string | undefined; label: string }[] = [
  { key: undefined, label: 'All' },
  { key: 'standalone', label: 'Standalone' },
  { key: 'job', label: 'Job tasks' },
  { key: 'today', label: 'Due today' },
  { key: 'overdue', label: 'Overdue' },
];

function FilterBar({ filters }: { filters: Filters }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {FILTERS.map((f) => {
        const active = (filters.filter ?? undefined) === f.key;
        const href = f.key ? `/todo?filter=${f.key}` : '/todo';
        return (
          <Link
            key={f.label}
            href={href}
            aria-current={active ? 'true' : undefined}
            className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium transition ${
              active
                ? 'border-accent bg-accent text-surface'
                : 'border-edge bg-panel text-ink-2 hover:border-accent/50 hover:text-ink'
            }`}
          >
            {f.label}
          </Link>
        );
      })}
      <Link
        href={filters.priority ? '/todo' : '/todo?priority=high'}
        className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium transition ${
          filters.priority
            ? 'border-amber-400/50 bg-amber-400/10 text-amber-300'
            : 'border-edge bg-panel text-ink-2 hover:border-accent/50 hover:text-ink'
        }`}
      >
        High priority
      </Link>
    </div>
  );
}

function applyFilters(tasks: Task[], filters: Filters, groups: ReturnType<typeof groupTasks>): Task[] {
  let out = tasks;
  if (filters.filter === 'standalone') out = out.filter((t) => !t.entityType);
  if (filters.filter === 'job') out = out.filter((t) => t.entityType === 'job');
  if (filters.filter === 'today') out = out.filter((t) => groups.today.includes(t));
  if (filters.filter === 'overdue') out = out.filter((t) => groups.overdue.includes(t));
  if (filters.priority) out = out.filter((t) => t.priority === 'high' || t.priority === 'urgent');
  return out;
}

async function TaskSections({ filters }: { filters: Filters }) {
  const [tasksRaw, jobs, quotes, invoices, leads] = await Promise.all([
    getTasks(),
    getJobs(),
    getQuotes(),
    getInvoices(),
    getLeads(),
  ]);
  const tasks = labelTasks(tasksRaw, { jobs, quotes, invoices, leads });
  const groups = groupTasks(tasks);

  const filtered = Boolean(filters.filter || filters.priority);
  const keep = (list: Task[]) => (filtered ? applyFilters(list, filters, groups) : list);

  const sections: { title: string; items: Task[]; tone?: 'bad' }[] = [
    { title: 'Overdue', items: keep(groups.overdue), tone: 'bad' },
    { title: 'Today', items: keep(groups.today) },
    { title: 'Upcoming', items: keep(groups.upcoming) },
    { title: 'No date', items: keep(groups.noDate) },
  ];
  const anyOpen = sections.some((s) => s.items.length > 0);
  const completed = keep(groups.completed).slice(0, 15);

  return (
    <div className="space-y-5">
      {!anyOpen && (
        <EmptyState
          title={filtered ? 'No tasks match' : 'Nothing on the list'}
          message={
            filtered
              ? 'Try clearing the filters.'
              : 'Add your first task with the New Task button, the + button, or ⌘K → “Create task”.'
          }
        />
      )}
      {sections.map(
        (s) =>
          s.items.length > 0 && (
            <Card
              key={s.title}
              title={`${s.title} (${s.items.length})`}
              actions={
                s.tone === 'bad' ? <span className="text-xs font-medium text-bad">needs action</span> : undefined
              }
            >
              <div className="-mx-2 divide-y divide-edge-soft/60">
                {s.items.map((t) => (
                  <TaskItem key={t.id} task={t} />
                ))}
              </div>
            </Card>
          ),
      )}
      {completed.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none text-xs font-medium text-ink-4 hover:text-ink-2 [&::-webkit-details-marker]:hidden">
            Completed ({completed.length}) ▸
          </summary>
          <Card>
            <div className="-mx-2 divide-y divide-edge-soft/60">
              {completed.map((t) => (
                <TaskItem key={t.id} task={t} />
              ))}
            </div>
          </Card>
        </details>
      )}
    </div>
  );
}
