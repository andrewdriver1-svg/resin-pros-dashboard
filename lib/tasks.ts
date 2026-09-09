/**
 * Task domain — pure types + logic shared by To Do, Today, Calendar, jobs, and
 * (in Phase D) Claude's task tools. No I/O here; everything takes `now` so it's
 * deterministic and testable.
 */

import { businessConfig } from '@/config/business.config';
import { tzParts } from '@/lib/insights';

export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskEntityType = 'job' | 'quote' | 'invoice' | 'lead';
export type TaskSource = 'manual' | 'attention' | 'claude' | 'automation' | 'job' | 'system';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Calendar day due (YYYY-MM-DD, business TZ). */
  dueDate?: string;
  /** Exact due moment — set only when the task has a specific time. */
  dueAt?: string;
  entityType?: TaskEntityType;
  entityId?: string;
  /** Denormalized label for the linked entity (job title, quote number…). */
  entityLabel?: string;
  isPersonal: boolean;
  source: TaskSource;
  snoozedUntil?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const TASK_STATUSES: TaskStatus[] = ['open', 'in_progress', 'done', 'cancelled'];
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** True if the task still needs doing. */
export function isActionable(t: Task): boolean {
  return t.status === 'open' || t.status === 'in_progress';
}

/** YYYY-MM-DD for an instant in the business timezone. */
export function dayKey(input: string | number | Date, tz: string = businessConfig.contact.timezone): string {
  const { y, m, d } = tzParts(input, tz);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Today + N days as a YYYY-MM-DD key, anchored to the BUSINESS day — never the
 * browser's UTC date. At 9 PM ET "tomorrow" must mean the next business day,
 * not UTC-today + 1 (which lands a day late).
 */
export function shiftBusinessDay(days: number, now: Date = new Date()): string {
  return new Date(Date.parse(dayKey(now)) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The day a task belongs to, if it has one. */
export function taskDayKey(t: Task): string | null {
  if (t.dueAt) return dayKey(t.dueAt);
  if (t.dueDate) return t.dueDate;
  return null;
}

export interface TaskGroups {
  overdue: Task[];
  today: Task[];
  upcoming: Task[];
  noDate: Task[];
  /** Recently finished (done/cancelled), newest first. */
  completed: Task[];
}

/**
 * The To Do view's shape: emphasize what needs action. Snoozed tasks whose
 * snooze hasn't expired are treated as not-yet-due (they move to upcoming).
 */
export function groupTasks(tasks: Task[], now: Date = new Date()): TaskGroups {
  const todayKeyStr = dayKey(now);
  const nowMs = now.getTime();
  const groups: TaskGroups = { overdue: [], today: [], upcoming: [], noDate: [], completed: [] };

  for (const t of tasks) {
    if (!isActionable(t)) {
      groups.completed.push(t);
      continue;
    }
    const snoozed = t.snoozedUntil && new Date(t.snoozedUntil).getTime() > nowMs;
    const key = taskDayKey(t);
    if (!key) {
      groups.noDate.push(t);
    } else if (snoozed) {
      groups.upcoming.push(t);
    } else if (key < todayKeyStr) {
      groups.overdue.push(t);
    } else if (key === todayKeyStr) {
      groups.today.push(t);
    } else {
      groups.upcoming.push(t);
    }
  }

  const byUrgency = (a: Task, b: Task) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    (taskDayKey(a) ?? '9999').localeCompare(taskDayKey(b) ?? '9999') ||
    (a.dueAt ?? '').localeCompare(b.dueAt ?? '');

  groups.overdue.sort(byUrgency);
  groups.today.sort(byUrgency);
  groups.upcoming.sort(
    (a, b) => (taskDayKey(a) ?? '9999').localeCompare(taskDayKey(b) ?? '9999') || byUrgency(a, b),
  );
  groups.noDate.sort(byUrgency);
  groups.completed.sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));
  return groups;
}

/** Human label for a due day relative to now: Today / Tomorrow / Mon, Sep 14 / 3 days overdue. */
export function dueLabel(t: Task, now: Date = new Date()): string {
  const key = taskDayKey(t);
  if (!key) return 'No date';
  const today = dayKey(now);
  const diffDays = Math.round((Date.parse(key) - Date.parse(today)) / 86_400_000);
  let day: string;
  if (diffDays === 0) day = 'Today';
  else if (diffDays === 1) day = 'Tomorrow';
  else if (diffDays === -1) day = 'Yesterday';
  else if (diffDays < -1) day = `${-diffDays} days overdue`;
  else
    day = new Intl.DateTimeFormat(businessConfig.currency.locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${key}T00:00:00Z`));
  if (t.dueAt) {
    const time = new Intl.DateTimeFormat(businessConfig.currency.locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: businessConfig.contact.timezone,
    }).format(new Date(t.dueAt));
    return `${day} · ${time}`;
  }
  return day;
}

// ── palette quick entry: "task order material friday" ────────────────────────

const DAY_WORDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Minimal deterministic quick-entry parse for the command palette. Recognizes a
 * trailing day word ("today", "tomorrow", weekday names) and strips it from the
 * title. Real natural language is Phase D's job — this stays intentionally dumb
 * and predictable.
 */
export function parseQuickTask(
  input: string,
  now: Date = new Date(),
): { title: string; dueDate?: string } {
  const words = input.trim().split(/\s+/);
  if (words.length < 2) return { title: input.trim() };
  const last = words[words.length - 1].toLowerCase();

  const todayKeyStr = dayKey(now);
  const todayDow = new Date(`${todayKeyStr}T12:00:00Z`).getUTCDay();

  let offset: number | null = null;
  if (last === 'today') offset = 0;
  else if (last === 'tomorrow') offset = 1;
  else {
    const idx = DAY_WORDS.indexOf(last);
    if (idx >= 0) {
      offset = (idx - todayDow + 7) % 7;
      if (offset === 0) offset = 7; // "friday" said on a Friday means next Friday
    }
  }
  if (offset == null) return { title: input.trim() };

  const due = new Date(Date.parse(todayKeyStr) + offset * 86_400_000);
  return {
    title: words.slice(0, -1).join(' '),
    dueDate: due.toISOString().slice(0, 10),
  };
}

// ── enrichment ───────────────────────────────────────────────────────────────

/**
 * Attach human labels to entity-linked tasks from already-loaded records.
 * Pure and cheap — pages load these lists anyway.
 */
export function labelTasks(
  tasks: Task[],
  lookup: {
    jobs?: { id: string; title: string; clientName: string }[];
    quotes?: { id: string; number: string; clientName: string }[];
    invoices?: { id: string; number: string; clientName: string }[];
    leads?: { id: string; clientName: string }[];
  },
): Task[] {
  const jobs = new Map((lookup.jobs ?? []).map((j) => [j.id, `${j.title}`]));
  const quotes = new Map((lookup.quotes ?? []).map((q) => [q.id, `Quote ${q.number} · ${q.clientName}`]));
  const invoices = new Map((lookup.invoices ?? []).map((i) => [i.id, `Invoice ${i.number} · ${i.clientName}`]));
  const leads = new Map((lookup.leads ?? []).map((l) => [l.id, `Lead: ${l.clientName}`]));
  return tasks.map((t) => {
    if (t.entityLabel || !t.entityType || !t.entityId) return t;
    const label =
      t.entityType === 'job'
        ? jobs.get(t.entityId)
        : t.entityType === 'quote'
          ? quotes.get(t.entityId)
          : t.entityType === 'invoice'
            ? invoices.get(t.entityId)
            : leads.get(t.entityId);
    return label ? { ...t, entityLabel: label } : t;
  });
}
