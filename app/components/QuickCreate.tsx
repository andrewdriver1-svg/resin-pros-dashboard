'use client';

/**
 * Quick Create — the persistent "+" and the fast task/event forms.
 *
 * Mounted once in the shell. Anything can open a prefilled task form via
 * openTaskForm() (attention items, job pages, the ⌘K palette); the forms call
 * the audited server actions and refresh the route. Deliberately small: a
 * task should take seconds, not a workflow.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createEvent, createTask } from '@/lib/actions/ops';
import { NEW_EVENT_EVENT, NEW_TASK_EVENT, type TaskPrefill } from './os-events';
import { dayKeyAndMinutesToIso } from '@/lib/calendar';
import { dayKey } from '@/lib/tasks';

export interface JobOption {
  id: string;
  title: string;
  clientName: string;
  status: string;
}

type Mode = 'closed' | 'menu' | 'task' | 'event';

export function QuickCreate({ jobOptions }: { jobOptions: JobOption[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('closed');
  const [prefill, setPrefill] = useState<TaskPrefill>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Task form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [jobQuery, setJobQuery] = useState('');
  const [linked, setLinked] = useState<{ type: 'job' | 'quote' | 'invoice' | 'lead' | 'customer'; id: string; label: string } | null>(null);
  const [personal, setPersonal] = useState(false);

  // Event form state
  const [evTitle, setEvTitle] = useState('');
  const [evDate, setEvDate] = useState('');
  const [evStart, setEvStart] = useState('');
  const [evEnd, setEvEnd] = useState('');
  const [evKind, setEvKind] = useState<'personal' | 'business' | 'meeting' | 'reminder' | 'blocked'>('personal');

  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onNewTask = (e: Event) => {
      const detail = (e as CustomEvent<TaskPrefill>).detail ?? {};
      setPrefill(detail);
      setTitle(detail.title ?? '');
      setDueDate(detail.dueDate ?? '');
      setDueTime('');
      setDescription('');
      setPriority('normal');
      setPersonal(false);
      setJobQuery('');
      setLinked(
        detail.entityType && detail.entityId
          ? { type: detail.entityType, id: detail.entityId, label: detail.entityLabel ?? detail.entityType }
          : null,
      );
      setError(null);
      setMode('task');
    };
    const onNewEvent = () => {
      setEvTitle('');
      setEvDate(dayKey(new Date()));
      setEvStart('');
      setEvEnd('');
      setEvKind('personal');
      setError(null);
      setMode('event');
    };
    window.addEventListener(NEW_TASK_EVENT, onNewTask);
    window.addEventListener(NEW_EVENT_EVENT, onNewEvent);
    return () => {
      window.removeEventListener(NEW_TASK_EVENT, onNewTask);
      window.removeEventListener(NEW_EVENT_EVENT, onNewEvent);
    };
  }, []);

  useEffect(() => {
    if (mode === 'task' || mode === 'event') titleRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (mode === 'closed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('closed');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const jobMatches =
    jobQuery.trim().length > 0
      ? jobOptions
          .filter(
            (j) =>
              j.title.toLowerCase().includes(jobQuery.toLowerCase()) ||
              j.clientName.toLowerCase().includes(jobQuery.toLowerCase()),
          )
          .slice(0, 6)
      : [];

  const submitTask = () => {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const dueAt = dueDate && dueTime ? dayKeyAndMinutesToIso(dueDate, parseTime(dueTime)) : undefined;
      const res = await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        dueDate: dueDate || undefined,
        dueAt,
        entityType: linked?.type,
        entityId: linked?.id,
        isPersonal: personal,
        source: prefill.entityType ? 'attention' : 'manual',
      });
      if (!res.ok) {
        setError(res.message ?? 'Something went wrong.');
        return;
      }
      setMode('closed');
      router.refresh();
    });
  };

  const submitEvent = () => {
    if (!evTitle.trim() || !evDate) return;
    setError(null);
    startTransition(async () => {
      const startsAt = dayKeyAndMinutesToIso(evDate, evStart ? parseTime(evStart) : 9 * 60);
      const endsAt = evEnd ? dayKeyAndMinutesToIso(evDate, parseTime(evEnd)) : undefined;
      const res = await createEvent({
        title: evTitle.trim(),
        kind: evKind,
        isPersonal: evKind === 'personal',
        startsAt,
        endsAt,
        allDay: !evStart,
      });
      if (!res.ok) {
        setError(res.message ?? 'Something went wrong.');
        return;
      }
      setMode('closed');
      router.refresh();
    });
  };

  const input =
    'w-full rounded-lg border border-edge bg-panel-2/50 px-3 py-2 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none';
  const label = 'block text-xs font-medium uppercase tracking-wide text-ink-4';

  return (
    <>
      {/* Persistent, restrained "+" */}
      <button
        type="button"
        onClick={() => setMode(mode === 'closed' ? 'menu' : 'closed')}
        aria-label="Quick create"
        aria-expanded={mode !== 'closed'}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-panel text-ink-2 shadow-lg transition-colors duration-150 hover:border-accent/50 hover:text-accent"
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M10 4v12M4 10h12" strokeLinecap="round" />
        </svg>
      </button>

      {mode === 'menu' && (
        <div className="fixed bottom-20 right-5 z-40 w-44 overflow-hidden rounded-xl border border-edge bg-panel shadow-xl">
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(NEW_TASK_EVENT, { detail: {} }))} className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-panel-2">
            Task
          </button>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(NEW_EVENT_EVENT))} className="block w-full px-4 py-2.5 text-left text-sm text-ink hover:bg-panel-2">
            Calendar event
          </button>
          <div className="px-4 py-2 text-xs text-ink-4">Notes live on each record.</div>
        </div>
      )}

      {(mode === 'task' || mode === 'event') && (
        <div className="fixed inset-0 z-50">
          <div aria-hidden className="absolute inset-0 bg-black/60" onClick={() => setMode('closed')} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={mode === 'task' ? 'New task' : 'New event'}
            className="absolute inset-x-0 top-[10vh] mx-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-edge bg-panel p-5 shadow-2xl"
          >
            <h2 className="mb-4 text-sm font-semibold text-ink">{mode === 'task' ? 'New task' : 'New calendar event'}</h2>

            {mode === 'task' ? (
              <div className="space-y-3">
                <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitTask()} placeholder="What needs doing?" className={input} />
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details (optional)" rows={2} className={input} />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <span className={label}>Due</span>
                    <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${input} mt-1`} />
                  </div>
                  <div>
                    <span className={label}>Time</span>
                    <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={`${input} mt-1`} />
                  </div>
                  <div>
                    <span className={label}>Priority</span>
                    <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={`${input} mt-1`}>
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>

                {/* Job link — optional. No job selected = standalone to-do. */}
                <div>
                  <span className={label}>Link to job (optional)</span>
                  {linked ? (
                    <div className="mt-1 flex items-center justify-between rounded-lg border border-edge bg-panel-2/50 px-3 py-2 text-sm">
                      <span className="truncate text-ink-2">{linked.label}</span>
                      <button type="button" onClick={() => setLinked(null)} className="ml-2 text-xs text-ink-4 hover:text-bad">
                        Unlink
                      </button>
                    </div>
                  ) : (
                    <>
                      <input value={jobQuery} onChange={(e) => setJobQuery(e.target.value)} placeholder="Search jobs…" className={`${input} mt-1`} />
                      {jobMatches.length > 0 && (
                        <div className="mt-1 overflow-hidden rounded-lg border border-edge bg-panel-2/50">
                          {jobMatches.map((j) => (
                            <button
                              key={j.id}
                              type="button"
                              onClick={() => {
                                setLinked({ type: 'job', id: j.id, label: j.title });
                                setJobQuery('');
                              }}
                              className="block w-full px-3 py-2 text-left text-sm hover:bg-panel-2"
                            >
                              <span className="text-ink">{j.title}</span>
                              <span className="ml-2 text-xs text-ink-4">
                                {j.clientName} · {j.status.replace(/_/g, ' ')}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <label className="flex items-center gap-2 text-xs text-ink-3">
                  <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} className="h-3.5 w-3.5" />
                  Personal (kept out of business reporting)
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <input ref={titleRef} value={evTitle} onChange={(e) => setEvTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitEvent()} placeholder="Event title" className={input} />
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <span className={label}>Date</span>
                    <input type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} className={`${input} mt-1`} />
                  </div>
                  <div>
                    <span className={label}>Start</span>
                    <input type="time" value={evStart} onChange={(e) => setEvStart(e.target.value)} className={`${input} mt-1`} />
                  </div>
                  <div>
                    <span className={label}>End</span>
                    <input type="time" value={evEnd} onChange={(e) => setEvEnd(e.target.value)} className={`${input} mt-1`} />
                  </div>
                </div>
                <div>
                  <span className={label}>Type</span>
                  <select value={evKind} onChange={(e) => setEvKind(e.target.value as typeof evKind)} className={`${input} mt-1`}>
                    <option value="personal">Personal</option>
                    <option value="business">Business</option>
                    <option value="meeting">Meeting</option>
                    <option value="reminder">Reminder</option>
                    <option value="blocked">Blocked time</option>
                  </select>
                </div>
              </div>
            )}

            {error && <p className="mt-3 text-xs text-bad">{error}</p>}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setMode('closed')} className="rounded-lg px-3 py-2 text-sm text-ink-3 hover:text-ink">
                Cancel
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={mode === 'task' ? submitTask : submitEvent}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface transition hover:bg-accent-soft disabled:opacity-50"
              >
                {pending ? 'Saving…' : mode === 'task' ? 'Create task' : 'Create event'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** "14:30" → minutes since midnight. */
function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0);
}
