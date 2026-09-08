'use client';

import { openTaskForm } from '@/app/components/os-events';

export function NewTaskButton() {
  return (
    <button
      type="button"
      onClick={() => openTaskForm()}
      className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-surface transition hover:bg-accent-soft"
    >
      + New task
    </button>
  );
}
