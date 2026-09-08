/**
 * Calendar domain — pure logic that unifies three sources into one schedule:
 *
 *   internal events (Supabase, editable)
 *   tasks with due dates (the SAME Task objects as To Do — never duplicated)
 *   Jobber job schedule (virtual, read-only/locked — we never write to Jobber)
 *
 * Everything takes `now`/dates explicitly and works in the business timezone.
 */

import { businessConfig } from '@/config/business.config';
import type { Job } from '@/lib/db/types';
import { dayKey, isActionable, type Task } from '@/lib/tasks';

const TZ = businessConfig.contact.timezone;
const DAY_MS = 86_400_000;

export type CalendarEventKind = 'personal' | 'business' | 'meeting' | 'reminder' | 'blocked';

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  kind: CalendarEventKind;
  isPersonal: boolean;
  startsAt: string;
  endsAt?: string;
  allDay: boolean;
  entityType?: string;
  entityId?: string;
  source: 'internal' | 'external' | 'jobber';
  createdAt: string;
}

/** One renderable thing on the calendar, whatever its source. */
export interface CalendarItem {
  /** 'event:<id>' | 'task:<id>' | 'job:<id>' */
  id: string;
  source: 'event' | 'task' | 'job';
  sourceId: string;
  title: string;
  subtitle?: string;
  /** Semantic type for restrained visual differentiation. */
  type: 'personal' | 'meeting' | 'blocked' | 'reminder' | 'business' | 'job' | 'task';
  dayKey: string;
  /** Minutes from midnight (business TZ); null = all-day/undated-time. */
  startMin: number | null;
  durationMin: number;
  /** External/synced items can't be dragged or edited here. */
  locked: boolean;
  done?: boolean;
}

function minutesInDay(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}

export function buildCalendarItems(input: {
  events: CalendarEvent[];
  tasks: Task[];
  jobs: Job[];
}): CalendarItem[] {
  const items: CalendarItem[] = [];

  for (const e of input.events) {
    const durationMin =
      e.endsAt && !e.allDay
        ? Math.max(30, Math.round((new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 60000))
        : 60;
    items.push({
      id: `event:${e.id}`,
      source: 'event',
      sourceId: e.id,
      title: e.title,
      subtitle: e.isPersonal ? 'Personal' : 'Business',
      type: e.kind === 'personal' ? 'personal' : e.kind === 'meeting' ? 'meeting' : e.kind === 'blocked' ? 'blocked' : e.kind === 'reminder' ? 'reminder' : 'business',
      dayKey: dayKey(e.startsAt),
      startMin: e.allDay ? null : minutesInDay(e.startsAt),
      durationMin,
      locked: e.source !== 'internal',
    });
  }

  for (const t of input.tasks) {
    if (t.status === 'cancelled') continue;
    const key = t.dueAt ? dayKey(t.dueAt) : t.dueDate;
    if (!key) continue;
    items.push({
      id: `task:${t.id}`,
      source: 'task',
      sourceId: t.id,
      title: t.title,
      subtitle: t.entityLabel ?? (t.isPersonal ? 'Personal' : 'Task'),
      type: 'task',
      dayKey: key,
      startMin: t.dueAt ? minutesInDay(t.dueAt) : null,
      durationMin: 30,
      locked: false,
      done: !isActionable(t),
    });
  }

  for (const j of input.jobs) {
    if (!j.scheduledAt) continue;
    if (j.status !== 'scheduled' && j.status !== 'in_progress') continue;
    const startMin = minutesInDay(j.scheduledAt);
    items.push({
      id: `job:${j.id}`,
      source: 'job',
      sourceId: j.id,
      title: j.title,
      subtitle: j.clientName,
      type: 'job',
      dayKey: dayKey(j.scheduledAt),
      // Jobber "midnight" scheduling means "that day", not 12:00 AM — treat as all-day.
      startMin: startMin === 0 ? null : startMin,
      durationMin: 8 * 60,
      locked: true, // read-only: we never drag-reschedule Jobber from here
    });
  }

  return items.sort(
    (a, b) => a.dayKey.localeCompare(b.dayKey) || (a.startMin ?? -1) - (b.startMin ?? -1),
  );
}

export function itemsForDay(items: CalendarItem[], key: string): CalendarItem[] {
  return items.filter((i) => i.dayKey === key);
}

// ── grids ────────────────────────────────────────────────────────────────────

/** The 7 day-keys (Mon…Sun) of the week containing `anchor`. */
export function weekDayKeys(anchor: string): string[] {
  const t = Date.parse(`${anchor}T12:00:00Z`);
  const dow = new Date(t).getUTCDay(); // 0=Sun
  const monday = t - ((dow + 6) % 7) * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => new Date(monday + i * DAY_MS).toISOString().slice(0, 10));
}

/** Full month grid (weeks of 7 day-keys, Mon-start) containing `anchor`'s month. */
export function monthGrid(anchor: string): { weeks: string[][]; month: number; year: number } {
  const [y, m] = anchor.split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const firstWeek = weekDayKeys(first);
  const weeks: string[][] = [firstWeek];
  let cursor = firstWeek[6];
  while (true) {
    const next = new Date(Date.parse(`${cursor}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
    const [ny, nm] = next.split('-').map(Number);
    if (ny > y || (ny === y && nm > m)) break;
    const week = weekDayKeys(next);
    weeks.push(week);
    cursor = week[6];
    if (weeks.length > 6) break; // safety
  }
  return { weeks, month: m, year: y };
}

export function shiftDay(key: string, days: number): string {
  return new Date(Date.parse(`${key}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Combine a day key + minutes into an ISO instant in the business timezone. */
export function dayKeyAndMinutesToIso(key: string, minutes: number): string {
  // Find the TZ offset in effect on that day by probing noon UTC.
  const probe = new Date(`${key}T12:00:00Z`);
  const tzHour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(probe),
  );
  const offsetHours = tzHour - 12; // e.g. -4 for EDT
  const utcMs = Date.parse(`${key}T00:00:00Z`) + (minutes - offsetHours * 60) * 60_000;
  return new Date(utcMs).toISOString();
}
