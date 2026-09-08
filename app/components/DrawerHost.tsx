'use client';

/**
 * Context drawers — records open in a right-side drawer instead of navigating
 * away, so the OS keeps your place. One host, mounted in the shell; surfaces
 * hand it a payload via openDrawer(). Task / Job / Quote in Phase C; more
 * entity kinds slot in as cases. "Ask Claude" lands here in Phase D.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addNote, completeTask, reopenTask, updateTask } from '@/lib/actions/ops';
import { dueLabel, isActionable, type Task } from '@/lib/tasks';
import { formatDate, formatDateTime, formatMoney, humanizeStatus } from './format';
import { StatusBadge } from './ui';
import { OPEN_DRAWER_EVENT, openTaskForm, type DrawerPayload } from './os-events';

export function DrawerHost() {
  const [payload, setPayload] = useState<DrawerPayload | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => setPayload((e as CustomEvent<DrawerPayload>).detail);
    window.addEventListener(OPEN_DRAWER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_DRAWER_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!payload) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPayload(null);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [payload]);

  if (!payload) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden className="absolute inset-0 bg-black/50" onClick={() => setPayload(null)} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Record details"
        className="absolute inset-y-0 right-0 flex w-[min(26rem,100vw)] flex-col border-l border-edge bg-panel shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-edge-soft px-5 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-4">
            {payload.kind === 'task' ? 'Task' : payload.kind === 'job' ? 'Job' : 'Quote'}
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={() => setPayload(null)}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 hover:bg-panel-2 hover:text-ink"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {payload.kind === 'task' && <TaskDrawer task={payload.task} onClose={() => setPayload(null)} />}
          {payload.kind === 'job' && <JobDrawer payload={payload} />}
          {payload.kind === 'quote' && <QuoteDrawer payload={payload} />}
        </div>
      </aside>
    </div>
  );
}

// ── task ─────────────────────────────────────────────────────────────────────

function TaskDrawer({ task, onClose }: { task: Task; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const active = isActionable(task);

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, closeAfter = false) => {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setMsg(res.message ?? 'Something went wrong.');
      else if (closeAfter) onClose();
      router.refresh();
    });
  };

  const btn =
    'rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors duration-150 hover:border-accent/50 hover:text-accent disabled:opacity-50';

  return (
    <div className="space-y-5">
      <div>
        <h2 className={`text-base font-semibold text-ink ${!active ? 'line-through decoration-ink-4' : ''}`}>{task.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <StatusBadge status={task.status} />
          <span className="text-ink-3">{humanizeStatus(task.priority)} priority</span>
          <span className="text-ink-3">· {dueLabel(task)}</span>
        </div>
        {task.entityLabel && (
          <div className="mt-2 text-xs text-ink-3">
            Linked to <span className="text-ink-2">{task.entityLabel}</span>
            {task.entityType === 'job' && task.entityId && (
              <Link href={`/jobs/${task.entityId}`} className="ml-2 font-medium text-accent hover:underline">
                Open job →
              </Link>
            )}
          </div>
        )}
        {task.description && <p className="mt-3 text-sm leading-relaxed text-ink-2">{task.description}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {active ? (
          <button type="button" disabled={pending} onClick={() => run(() => completeTask(task.id), true)} className={`${btn} border-good/40 text-good hover:border-good hover:text-good`}>
            ✓ Complete
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={() => run(() => reopenTask(task.id))} className={btn}>
            Reopen
          </button>
        )}
        {active && (
          <>
            <button type="button" disabled={pending} onClick={() => run(() => updateTask({ id: task.id, dueDate: shiftDate(1) }))} className={btn}>
              Due tomorrow
            </button>
            <button type="button" disabled={pending} onClick={() => run(() => updateTask({ id: task.id, dueDate: shiftDate(7) }))} className={btn}>
              Due next week
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => updateTask({ id: task.id, priority: task.priority === 'urgent' ? 'normal' : 'urgent' }))}
              className={btn}
            >
              {task.priority === 'urgent' ? 'Clear urgent' : 'Mark urgent'}
            </button>
            <button type="button" disabled={pending} onClick={() => run(() => updateTask({ id: task.id, status: 'cancelled' }), true)} className={`${btn} hover:border-bad/50 hover:text-bad`}>
              Cancel task
            </button>
          </>
        )}
      </div>

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-4">Add note</h3>
        <div className="mt-2 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note on this task…"
            className="w-full rounded-lg border border-edge bg-panel-2/50 px-3 py-2 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && note.trim()) {
                run(() => addNote({ entityType: 'task', entityId: task.id, body: note.trim() }));
                setNote('');
              }
            }}
          />
        </div>
      </div>

      <dl className="space-y-1 text-xs text-ink-4">
        <div>Created {formatDateTime(task.createdAt)}</div>
        {task.completedAt && <div>Completed {formatDateTime(task.completedAt)}</div>}
      </dl>

      {msg && <p className="text-xs text-bad">{msg}</p>}
    </div>
  );
}

function shiftDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

// ── job ──────────────────────────────────────────────────────────────────────

function JobDrawer({ payload }: { payload: Extract<DrawerPayload, { kind: 'job' }> }) {
  const { job, tasks = [], notes = [] } = payload;
  const openTasks = tasks.filter((t) => isActionable(t));
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-ink">{job.title}</h2>
        <div className="mt-1 text-sm text-ink-3">{job.clientName}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={job.status} />
          <span className="text-sm font-medium tabular-nums text-ink">{formatMoney(job.value)}</span>
          {job.scheduledAt && <span className="text-xs text-ink-3">· {formatDate(job.scheduledAt)}</span>}
        </div>
        {job.address && <div className="mt-1 text-xs text-ink-4">{job.address}</div>}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-4">Open tasks ({openTasks.length})</h3>
          <button
            type="button"
            onClick={() => openTaskForm({ entityType: 'job', entityId: job.id, entityLabel: job.title })}
            className="text-xs font-medium text-accent hover:underline"
          >
            + Add task
          </button>
        </div>
        <ul className="mt-2 space-y-1">
          {openTasks.length === 0 && <li className="text-xs text-ink-4">Nothing open.</li>}
          {openTasks.slice(0, 6).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-ink-2">○ {t.title}</span>
              <span className="shrink-0 text-xs text-ink-4">{dueLabel(t)}</span>
            </li>
          ))}
        </ul>
      </div>

      {notes.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-4">Notes</h3>
          <ul className="mt-2 space-y-2">
            {notes.slice(0, 4).map((n) => (
              <li key={n.id} className="rounded-lg border border-edge-soft bg-panel-2/40 px-3 py-2 text-xs text-ink-2">
                {n.body}
                <span className="mt-1 block text-[10px] text-ink-4">{formatDate(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link
        href={`/jobs/${job.id}`}
        className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface transition hover:bg-accent-soft"
      >
        Open full job
      </Link>
    </div>
  );
}

// ── quote ────────────────────────────────────────────────────────────────────

function QuoteDrawer({ payload }: { payload: Extract<DrawerPayload, { kind: 'quote' }> }) {
  const { quote, classification } = payload;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-ink">Quote {quote.number}</h2>
        <div className="mt-1 text-sm text-ink-3">{quote.clientName}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={quote.status} />
          <span className="text-sm font-medium tabular-nums text-ink">{formatMoney(quote.amount)}</span>
          {quote.issuedAt && <span className="text-xs text-ink-3">· issued {formatDate(quote.issuedAt)}</span>}
        </div>
        {classification && (
          <div className="mt-2 text-xs text-ink-3">
            Internal review: <span className="text-ink-2">{humanizeStatus(classification)}</span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            openTaskForm({
              title: `Follow up Quote ${quote.number} — ${quote.clientName}`,
              entityType: 'quote',
              entityId: quote.id,
              entityLabel: `Quote ${quote.number} · ${quote.clientName}`,
            })
          }
          className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent/50 hover:text-accent"
        >
          Create follow-up
        </button>
        <Link
          href={`/quotes?q=${encodeURIComponent(quote.number)}`}
          className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-2 hover:border-accent/50 hover:text-accent"
        >
          View in list
        </Link>
      </div>
    </div>
  );
}
