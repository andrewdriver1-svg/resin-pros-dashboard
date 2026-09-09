import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getActivity,
  getCustomers,
  getInvoices,
  getJobs,
  getLeads,
  getNotes,
  getQuotes,
  getTasks,
} from '@/lib/db';
import { invoiceBalance } from '@/lib/insights';
import { isActionable, labelTasks } from '@/lib/tasks';
import { formatDate, formatDateTime, formatMoney, relativeTime } from '@/app/components/format';
import { Card, StatusBadge } from '@/app/components/ui';
import { TaskItem } from '@/app/components/TaskItem';
import { AddCustomerTaskButton, CustomerNoteForm } from './customer-controls';

export const dynamic = 'force-dynamic';

/**
 * Customer detail — the relationship view: everything the OS knows about one
 * client, drawn from records already synced (Jobber source truth) plus internal
 * tasks/notes/activity. No invented numbers: "collected to date" is summed
 * payments; there is deliberately NO profitability figure (costs aren't
 * job-attributed yet — see the job-costing plan).
 */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [customers, jobs, quotes, invoices, leads, tasksRaw, notes, activity] = await Promise.all([
    getCustomers(),
    getJobs(),
    getQuotes(),
    getInvoices(),
    getLeads(),
    getTasks(),
    getNotes(),
    getActivity(200),
  ]);
  const customer = customers.find((c) => c.id === id);
  if (!customer) notFound();

  const cid = customer.jobberClientId;
  const cJobs = jobs.filter((j) => j.jobberClientId === cid);
  const cQuotes = quotes.filter((q) => q.jobberClientId === cid);
  const cInvoices = invoices.filter((i) => i.jobberClientId === cid);
  const cLeads = leads.filter((l) => l.jobberClientId === cid);

  const recordIds = new Set<string>([
    customer.id,
    ...cJobs.map((j) => j.id),
    ...cQuotes.map((q) => q.id),
    ...cInvoices.map((i) => i.id),
    ...cLeads.map((l) => l.id),
  ]);

  const tasks = labelTasks(
    tasksRaw.filter((t) => t.entityId && recordIds.has(t.entityId)),
    { jobs: cJobs, quotes: cQuotes, invoices: cInvoices, leads: cLeads, customers: [customer] },
  );
  const openTasks = tasks.filter(isActionable);
  const cNotes = notes.filter((n) => n.entityId && recordIds.has(n.entityId));
  const cActivity = activity.filter((a) => a.entityId && recordIds.has(a.entityId)).slice(0, 12);

  const ar = cInvoices.reduce((s, i) => s + invoiceBalance(i), 0);
  const collected = cInvoices.reduce((s, i) => s + i.amountPaid, 0);
  const openQuoteValue = cQuotes.filter((q) => q.status === 'awaiting_response').reduce((s, q) => s + q.amount, 0);
  const openLeads = cLeads.filter((l) => l.status === 'new' || l.status === 'contacted');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">{customer.name}</h1>
          <div className="mt-1 text-sm text-ink-3">
            {[customer.email, customer.phone].filter(Boolean).join(' · ') || 'No contact details synced'}
          </div>
        </div>
        <Link href="/customers" className="text-sm font-medium text-accent hover:underline">
          ← All customers
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open quote value" value={openQuoteValue ? formatMoney(openQuoteValue) : '—'} />
        <Stat label="Outstanding AR" value={ar ? formatMoney(ar) : '$0'} warn={ar > 0} />
        <Stat label="Collected to date" value={collected ? formatMoney(collected) : '—'} />
        <Stat label="Jobs" value={String(cJobs.length || '—')} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card title={`Tasks (${openTasks.length} open)`} actions={<AddCustomerTaskButton customerId={customer.id} name={customer.name} />}>
          {openTasks.length === 0 ? (
            <p className="text-sm text-ink-4">No open tasks for this customer.</p>
          ) : (
            <div className="divide-y divide-edge-soft/60">
              {openTasks.slice(0, 8).map((t) => (
                <TaskItem key={t.id} task={t} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Notes (internal)">
          {cNotes.length === 0 ? (
            <p className="text-sm text-ink-4">No notes yet. Notes stay internal — they never sync to Jobber.</p>
          ) : (
            <ul className="space-y-2">
              {cNotes.slice(0, 6).map((n) => (
                <li key={n.id} className="rounded-lg bg-panel-2/50 px-3 py-2 text-sm text-ink-2">
                  {n.body}
                  <div className="mt-0.5 text-xs text-ink-4">{formatDate(n.createdAt)}</div>
                </li>
              ))}
            </ul>
          )}
          <CustomerNoteForm customerId={customer.id} />
        </Card>

        {openLeads.length > 0 && (
          <Card title={`Open leads (${openLeads.length})`}>
            <ul className="divide-y divide-edge-soft/60">
              {openLeads.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-ink-2">{l.summary || 'Request'}</span>
                  <span className="shrink-0 text-xs text-ink-4">{relativeTime(l.receivedAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title={`Quotes (${cQuotes.length})`}>
          {cQuotes.length === 0 ? (
            <p className="text-sm text-ink-4">No quotes for this customer.</p>
          ) : (
            <ul className="divide-y divide-edge-soft/60">
              {cQuotes.slice(0, 8).map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/quotes?q=${encodeURIComponent(q.number)}`} className="font-medium text-ink hover:text-accent">
                    {q.number}
                  </Link>
                  <StatusBadge status={q.status} />
                  <span className="ml-auto text-ink-2">{formatMoney(q.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Jobs (${cJobs.length})`}>
          {cJobs.length === 0 ? (
            <p className="text-sm text-ink-4">No jobs for this customer.</p>
          ) : (
            <ul className="divide-y divide-edge-soft/60">
              {cJobs.slice(0, 8).map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/jobs/${j.id}`} className="font-medium text-ink hover:text-accent">
                    {j.title}
                  </Link>
                  <StatusBadge status={j.status} />
                  <span className="ml-auto text-ink-2">{formatMoney(j.value)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Invoices (${cInvoices.length})`}>
          {cInvoices.length === 0 ? (
            <p className="text-sm text-ink-4">No invoices for this customer.</p>
          ) : (
            <ul className="divide-y divide-edge-soft/60">
              {cInvoices.slice(0, 8).map((i) => {
                const bal = invoiceBalance(i);
                return (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="font-medium text-ink">{i.number}</span>
                    <StatusBadge status={i.status} />
                    <span className="ml-auto text-ink-2">{formatMoney(i.amount)}</span>
                    {bal > 0 && <span className="text-xs font-medium text-warn">{formatMoney(bal)} due</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Recent activity">
          {cActivity.length === 0 ? (
            <p className="text-sm text-ink-4">Internal actions on this customer&apos;s records will show here.</p>
          ) : (
            <ul className="space-y-1.5">
              {cActivity.map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink-2">{a.summary}</span>
                  <span className="shrink-0 text-xs text-ink-4">{relativeTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="text-xs text-ink-4">
        Jobber source records are read-only here. Customer record last synced {formatDateTime(customer.updatedAt)}.
      </p>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-edge bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-ink-4">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${warn ? 'text-warn' : 'text-ink'}`}>{value}</div>
    </div>
  );
}
