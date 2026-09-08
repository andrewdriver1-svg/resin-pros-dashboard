'use client';

/**
 * One task row — the same component everywhere a task appears (To Do, Today,
 * Calendar day lists, job pages), so completing it anywhere behaves the same.
 * Checkbox completes with a subtle strike+fade; the row opens the task drawer.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { completeTask, reopenTask } from '@/lib/actions/ops';
import { dueLabel, isActionable, type Task } from '@/lib/tasks';
import { openDrawer } from './os-events';

const PRIORITY_DOT: Record<Task['priority'], string> = {
  urgent: 'bg-bad',
  high: 'bg-warn',
  normal: 'bg-ink-4',
  low: 'bg-edge',
};

export function TaskItem({ task, showDue = true }: { task: Task; showDue?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [justDone, setJustDone] = useState(false);
  const active = isActionable(task);
  const overdue = active && (dueLabel(task).includes('overdue') || dueLabel(task) === 'Yesterday');

  const toggle = () => {
    if (pending) return;
    if (active) setJustDone(true);
    startTransition(async () => {
      const res = active ? await completeTask(task.id) : await reopenTask(task.id);
      if (!res.ok) setJustDone(false);
      router.refresh();
    });
  };

  const struck = !active || justDone;

  return (
    <div
      className={`group flex items-center gap-3 rounded-lg px-2 py-2 transition-opacity duration-200 hover:bg-panel-2/60 ${
        struck ? 'opacity-55' : ''
      }`}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={active ? `Complete “${task.title}”` : `Reopen “${task.title}”`}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-200 ${
          struck ? 'border-good bg-good/20 text-good' : 'border-edge text-transparent hover:border-accent'
        }`}
      >
        <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="m5 10.5 3.5 3.5L15 6.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => openDrawer({ kind: 'task', task })}
        className="min-w-0 flex-1 text-left"
      >
        <span className={`block truncate text-sm text-ink ${struck ? 'line-through decoration-ink-4' : ''}`}>
          {task.title}
        </span>
        <span className="block truncate text-xs text-ink-4">
          {task.entityLabel ?? (task.isPersonal ? 'Personal' : 'Standalone')}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-2.5">
        {showDue && (
          <span className={`text-xs tabular-nums ${overdue ? 'font-medium text-bad' : 'text-ink-3'}`}>
            {dueLabel(task)}
          </span>
        )}
        {(task.priority === 'high' || task.priority === 'urgent') && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              task.priority === 'urgent' ? 'bg-red-400/10 text-red-300 ring-1 ring-inset ring-red-400/20' : 'text-amber-300'
            }`}
          >
            {task.priority}
          </span>
        )}
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[task.priority]}`} />
      </div>
    </div>
  );
}
