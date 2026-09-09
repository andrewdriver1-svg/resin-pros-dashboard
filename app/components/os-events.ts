'use client';

/**
 * The Business OS's tiny client-side event bus. Decoupled surfaces (palette,
 * attention rows, job pages, calendar) ask the shell-mounted hosts to open
 * the quick-create forms or a context drawer by dispatching these events —
 * no prop drilling, no global store.
 */

import type { Task } from '@/lib/tasks';
import type { Job, NoteRecord, Quote } from '@/lib/db/types';

export const NEW_TASK_EVENT = 'rp:new-task';
export const NEW_EVENT_EVENT = 'rp:new-event';
export const OPEN_DRAWER_EVENT = 'rp:open-drawer';

export interface TaskPrefill {
  title?: string;
  dueDate?: string;
  entityType?: 'job' | 'quote' | 'invoice' | 'lead' | 'customer';
  entityId?: string;
  entityLabel?: string;
}

export type DrawerPayload =
  | { kind: 'task'; task: Task }
  | { kind: 'job'; job: Job; tasks?: Task[]; notes?: NoteRecord[] }
  | { kind: 'quote'; quote: Quote; classification?: string };

export function openTaskForm(prefill?: TaskPrefill) {
  window.dispatchEvent(new CustomEvent(NEW_TASK_EVENT, { detail: prefill ?? {} }));
}

export function openEventForm() {
  window.dispatchEvent(new CustomEvent(NEW_EVENT_EVENT));
}

export function openDrawer(payload: DrawerPayload) {
  window.dispatchEvent(new CustomEvent(OPEN_DRAWER_EVENT, { detail: payload }));
}
