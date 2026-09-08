import { describe, expect, it } from 'vitest';
import {
  buildCalendarItems,
  dayKeyAndMinutesToIso,
  itemsForDay,
  monthGrid,
  shiftDay,
  weekDayKeys,
  type CalendarEvent,
} from './calendar';
import type { Job } from './db/types';
import type { Task } from './tasks';

const event = (o: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e1',
  title: 'Event',
  kind: 'personal',
  isPersonal: true,
  startsAt: '2026-09-08T14:30:00Z', // 10:30 AM ET
  allDay: false,
  source: 'internal',
  createdAt: '2026-09-01T00:00:00Z',
  ...o,
});

const task = (o: Partial<Task>): Task => ({
  id: 't1',
  title: 'Task',
  status: 'open',
  priority: 'normal',
  isPersonal: false,
  source: 'manual',
  createdAt: '2026-09-01T12:00:00Z',
  updatedAt: '2026-09-01T12:00:00Z',
  ...o,
});

const job = (o: Partial<Job>): Job => ({
  id: 'j1',
  title: 'Job',
  clientName: 'Client',
  status: 'scheduled',
  value: 1000,
  ...o,
});

describe('buildCalendarItems', () => {
  it('unifies events, dated tasks, and scheduled jobs into one list', () => {
    const items = buildCalendarItems({
      events: [event({})],
      tasks: [task({ dueAt: '2026-09-08T18:00:00Z' }), task({ id: 't2', dueDate: '2026-09-09' }), task({ id: 't3' })],
      jobs: [job({ scheduledAt: '2026-09-10T12:00:00Z' }), job({ id: 'j2', status: 'complete', scheduledAt: '2026-09-10T12:00:00Z' })],
    });
    const ids = items.map((i) => i.id);
    expect(ids).toContain('event:e1');
    expect(ids).toContain('task:t1');
    expect(ids).toContain('task:t2');
    expect(ids).not.toContain('task:t3'); // undated tasks stay off the calendar
    expect(ids).toContain('job:j1');
    expect(ids).not.toContain('job:j2'); // completed jobs aren't schedule
  });

  it('marks Jobber jobs locked and internal items draggable', () => {
    const items = buildCalendarItems({
      events: [event({})],
      tasks: [task({ dueDate: '2026-09-09' })],
      jobs: [job({ scheduledAt: '2026-09-10T12:00:00Z' })],
    });
    expect(items.find((i) => i.source === 'job')!.locked).toBe(true);
    expect(items.find((i) => i.source === 'event')!.locked).toBe(false);
    expect(items.find((i) => i.source === 'task')!.locked).toBe(false);
  });

  it('positions times in the business timezone and treats midnight jobs as all-day', () => {
    const items = buildCalendarItems({
      events: [event({})], // 10:30 AM ET
      tasks: [],
      jobs: [job({ scheduledAt: '2026-09-21T04:00:00Z' })], // midnight ET = "that day"
    });
    expect(items.find((i) => i.source === 'event')!.startMin).toBe(10 * 60 + 30);
    const jobItem = items.find((i) => i.source === 'job')!;
    expect(jobItem.startMin).toBeNull();
    expect(jobItem.dayKey).toBe('2026-09-21');
  });

  it('a date-only task shows in the all-day area, a timed task at its time', () => {
    const items = buildCalendarItems({
      events: [],
      tasks: [task({ id: 'dated', dueDate: '2026-09-09' }), task({ id: 'timed', dueAt: '2026-09-09T18:00:00Z' })],
      jobs: [],
    });
    expect(items.find((i) => i.sourceId === 'dated')!.startMin).toBeNull();
    expect(items.find((i) => i.sourceId === 'timed')!.startMin).toBe(14 * 60); // 2 PM ET
  });
});

describe('grids', () => {
  it('weekDayKeys returns Mon–Sun containing the anchor', () => {
    const days = weekDayKeys('2026-09-08'); // a Tuesday
    expect(days[0]).toBe('2026-09-07'); // Monday
    expect(days[6]).toBe('2026-09-13'); // Sunday
    expect(days).toHaveLength(7);
  });

  it('monthGrid covers the whole month in full weeks', () => {
    const grid = monthGrid('2026-09-15');
    expect(grid.month).toBe(9);
    const flat = grid.weeks.flat();
    expect(flat[0] <= '2026-09-01').toBe(true);
    expect(flat[flat.length - 1] >= '2026-09-30').toBe(true);
    expect(flat.length % 7).toBe(0);
  });

  it('shiftDay moves across month boundaries', () => {
    expect(shiftDay('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
  });
});

describe('dayKeyAndMinutesToIso', () => {
  it('round-trips a business-timezone wall-clock time', () => {
    // 2 PM ET on Sep 9 = 18:00 UTC (EDT, -4).
    expect(dayKeyAndMinutesToIso('2026-09-09', 14 * 60)).toBe('2026-09-09T18:00:00.000Z');
    // 9 AM ET in January (EST, -5) = 14:00 UTC.
    expect(dayKeyAndMinutesToIso('2026-01-15', 9 * 60)).toBe('2026-01-15T14:00:00.000Z');
  });
});

describe('itemsForDay', () => {
  it('filters by day key', () => {
    const items = buildCalendarItems({ events: [event({})], tasks: [], jobs: [] });
    expect(itemsForDay(items, '2026-09-08')).toHaveLength(1);
    expect(itemsForDay(items, '2026-09-09')).toHaveLength(0);
  });
});
