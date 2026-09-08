'use client';

import { openEventForm } from '@/app/components/os-events';

export function NewEventButton() {
  return (
    <button
      type="button"
      onClick={() => openEventForm()}
      className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-surface transition hover:bg-accent-soft"
    >
      + New event
    </button>
  );
}
