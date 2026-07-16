import Link from 'next/link';
import { Suspense } from 'react';
import { getJobs, getTodos } from '@/lib/db';
import { formatDate } from '@/app/components/format';
import { PageHeader, Card, StatGrid, StatTile, StatusBadge } from '@/app/components/ui';
import { EmptyState, StatGridSkeleton, TableSkeleton } from '@/app/components/states';
import type { MaterialTodo } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

export default function MaterialsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Materials & Equipment" description="What needs ordering, and for which job." />
      <Suspense fallback={<StatGridSkeleton tiles={3} />}>
        <TodoStats />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <TodoList />
      </Suspense>
    </div>
  );
}

async function TodoStats() {
  const todos = await getTodos();
  const needed = todos.filter((t) => t.status === 'needed').length;
  const ordered = todos.filter((t) => t.status === 'ordered').length;
  const received = todos.filter((t) => t.status === 'received').length;
  return (
    <StatGrid>
      <StatTile label="Needed" value={String(needed)} tone={needed > 0 ? 'negative' : 'default'} hint="Not yet ordered" />
      <StatTile label="Ordered" value={String(ordered)} hint="On the way" />
      <StatTile label="Received" value={String(received)} tone="positive" />
    </StatGrid>
  );
}

async function TodoList() {
  const [todos, jobs] = await Promise.all([getTodos(), getJobs()]);
  if (todos.length === 0) {
    return (
      <EmptyState
        title="Nothing to order"
        message="Material and equipment to-dos linked to jobs will appear here so nothing gets forgotten before a mobilization."
      />
    );
  }

  const jobTitle = (id?: string) => jobs.find((j) => j.id === id)?.title;
  // Show 'needed' first, then ordered, then received.
  const order: Record<MaterialTodo['status'], number> = { needed: 0, ordered: 1, received: 2 };
  const sorted = [...todos].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <Card>
      <ul className="divide-y divide-slate-100">
        {sorted.map((t) => (
          <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-900">{t.item}</span>
                {t.quantity && <span className="text-xs text-slate-500">×{t.quantity}</span>}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                  {t.kind === 'equipment' ? 'Equipment' : 'Material'}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {t.jobId ? (
                  <Link href={`/jobs/${t.jobId}`} className="text-sky-700 hover:underline">
                    {jobTitle(t.jobId) ?? 'Linked job'}
                  </Link>
                ) : (
                  'General stock'
                )}
                {t.neededBy ? ` · needed by ${formatDate(t.neededBy)}` : ''}
                {t.notes ? ` · ${t.notes}` : ''}
              </div>
            </div>
            <StatusBadge status={t.status} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
