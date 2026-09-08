import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCategory } from '@/config/business.config';
import { getJob, getNotes, getTasks } from '@/lib/db';
import { sumAmount } from '@/lib/spending';
import { isActionable } from '@/lib/tasks';
import { formatMoney, formatDate } from '@/app/components/format';
import { PageHeader, Card, StatGrid, StatTile, StatusBadge, TableWrap } from '@/app/components/ui';
import { EmptyState } from '@/app/components/states';
import { TaskItem } from '@/app/components/TaskItem';
import { AddJobTaskButton, JobNoteForm } from './job-task-controls';

export const dynamic = 'force-dynamic';

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [job, allTasks, allNotes] = await Promise.all([getJob(id), getTasks(), getNotes()]);
  if (!job) notFound();

  const jobTasks = allTasks
    .filter((t) => t.entityType === 'job' && t.entityId === id)
    .map((t) => ({ ...t, entityLabel: job.title }));
  const openTasks = jobTasks.filter(isActionable);
  const doneTasks = jobTasks.filter((t) => !isActionable(t)).slice(0, 5);
  const jobNotes = allNotes.filter((n) => n.entityType === 'job' && n.entityId === id);

  const totalCost = sumAmount(job.costs);
  const margin = job.value - totalCost;
  const invoicedPaid = job.invoices.reduce((s, i) => s + i.amountPaid, 0);
  const invoicedTotal = job.invoices.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={job.title}
        description={`${job.clientName}${job.address ? ` · ${job.address}` : ''}`}
        actions={
          <>
            <StatusBadge status={job.status} />
            <Link href="/jobs" className="text-xs font-medium text-accent hover:underline">
              ← Back to jobs
            </Link>
          </>
        }
      />

      <StatGrid>
        <StatTile label="Contract value" value={formatMoney(job.value)} />
        <StatTile label="Costs to date" value={formatMoney(totalCost)} hint={`${job.costs.length} line items`} />
        <StatTile
          label="Margin"
          value={formatMoney(margin)}
          tone={margin >= 0 ? 'positive' : 'negative'}
          hint={job.value > 0 ? `${Math.round((margin / job.value) * 100)}% of contract` : undefined}
        />
        <StatTile
          label="Invoiced / paid"
          value={`${formatMoney(invoicedPaid)}`}
          hint={`of ${formatMoney(invoicedTotal)} invoiced`}
        />
      </StatGrid>

      {(job.scheduledAt || job.completedAt || job.notes) && (
        <Card title="Details">
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-3">Scheduled</dt>
              <dd className="mt-0.5 text-ink">{formatDate(job.scheduledAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-3">Completed</dt>
              <dd className="mt-0.5 text-ink">{formatDate(job.completedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-ink-3">Jobber ID</dt>
              <dd className="mt-0.5 truncate text-ink" title={job.jobberId}>
                {job.jobberId ?? '—'}
              </dd>
            </div>
            {job.notes && (
              <div className="sm:col-span-3">
                <dt className="text-xs uppercase tracking-wide text-ink-3">Notes</dt>
                <dd className="mt-0.5 text-ink">{job.notes}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title={`Tasks (${openTasks.length} open)`} actions={<AddJobTaskButton jobId={job.id} jobTitle={job.title} />}>
          {jobTasks.length === 0 ? (
            <EmptyState title="No tasks yet" message="Tasks added here link to this job automatically and show up in To Do, Today, and Calendar." />
          ) : (
            <div className="-mx-2 divide-y divide-edge-soft/60">
              {openTasks.map((t) => (
                <TaskItem key={t.id} task={t} />
              ))}
              {doneTasks.map((t) => (
                <TaskItem key={t.id} task={t} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Notes (internal)">
          {jobNotes.length === 0 ? (
            <p className="py-2 text-sm text-ink-3">No notes yet. Notes stay internal — they never sync to Jobber.</p>
          ) : (
            <ul className="space-y-2">
              {jobNotes.map((n) => (
                <li key={n.id} className="rounded-lg border border-edge-soft bg-panel-2/40 px-3 py-2 text-sm text-ink-2">
                  {n.body}
                  <span className="mt-1 block text-[11px] text-ink-4">{formatDate(n.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
          <JobNoteForm jobId={job.id} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Quotes">
          {job.quotes.length === 0 ? (
            <EmptyState title="No quotes" message="No quotes are linked to this job." />
          ) : (
            <ul className="divide-y divide-edge-soft">
              {job.quotes.map((q) => (
                <li key={q.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <div className="font-medium text-ink">{q.number}</div>
                    <div className="text-xs text-ink-3">{formatDate(q.issuedAt)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={q.status} />
                    <span className="font-medium text-ink">{formatMoney(q.amount)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Invoices">
          {job.invoices.length === 0 ? (
            <EmptyState title="No invoices" message="No invoices are linked to this job yet." />
          ) : (
            <ul className="divide-y divide-edge-soft">
              {job.invoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <div className="font-medium text-ink">{inv.number}</div>
                    <div className="text-xs text-ink-3">
                      Due {formatDate(inv.dueAt)} · paid {formatMoney(inv.amountPaid)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={inv.status} />
                    <span className="font-medium text-ink">{formatMoney(inv.amount)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Costs & transactions">
        {job.costs.length === 0 ? (
          <EmptyState
            title="No costs recorded"
            message="Material, equipment, and labor costs attributed to this job will appear here (from imported statements or manual entries)."
          />
        ) : (
          <TableWrap>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-edge-soft text-left text-xs uppercase tracking-wide text-ink-3">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge-soft">
                {job.costs.map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{formatDate(c.date)}</td>
                    <td className="px-3 py-2.5 text-ink">{c.description}</td>
                    <td className="px-3 py-2.5 text-ink-2">{getCategory(c.categoryId).label}</td>
                    <td className="px-3 py-2.5 text-xs text-ink-3">{c.source.replace(/_/g, ' ')}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium text-ink">
                      {formatMoney(c.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-edge">
                  <td colSpan={4} className="px-3 py-2.5 text-right text-xs font-medium uppercase text-ink-3">
                    Total
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-ink">
                    {formatMoney(totalCost)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="Materials & equipment to-do">
        {job.todos.length === 0 ? (
          <EmptyState title="Nothing to order" message="No material or equipment to-dos are linked to this job." />
        ) : (
          <ul className="divide-y divide-edge-soft">
            {job.todos.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">
                    {t.item}
                    {t.quantity ? ` · ${t.quantity}` : ''}
                  </div>
                  <div className="text-xs text-ink-3">
                    {t.kind === 'equipment' ? 'Equipment' : 'Material'}
                    {t.neededBy ? ` · needed by ${formatDate(t.neededBy)}` : ''}
                  </div>
                </div>
                <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
