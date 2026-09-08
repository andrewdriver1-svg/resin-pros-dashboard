import { describe, expect, it } from 'vitest';
import { dueLabel, groupTasks, labelTasks, parseQuickTask, taskDayKey, type Task } from './tasks';

// Tue Sep 8 2026, noon ET.
const NOW = new Date('2026-09-08T16:00:00Z');

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

describe('groupTasks', () => {
  it('buckets by day relative to now, in the business timezone', () => {
    const groups = groupTasks(
      [
        task({ id: 'over', dueDate: '2026-09-05' }),
        task({ id: 'today-date', dueDate: '2026-09-08' }),
        // 11 PM ET Sep 8 is 3 AM UTC Sep 9 — must still count as "today".
        task({ id: 'today-at', dueAt: '2026-09-09T03:00:00Z' }),
        task({ id: 'up', dueDate: '2026-09-12' }),
        task({ id: 'none' }),
        task({ id: 'done', status: 'done', completedAt: '2026-09-07T12:00:00Z' }),
      ],
      NOW,
    );
    expect(groups.overdue.map((t) => t.id)).toEqual(['over']);
    expect(groups.today.map((t) => t.id).sort()).toEqual(['today-at', 'today-date']);
    expect(groups.upcoming.map((t) => t.id)).toEqual(['up']);
    expect(groups.noDate.map((t) => t.id)).toEqual(['none']);
    expect(groups.completed.map((t) => t.id)).toEqual(['done']);
  });

  it('orders by priority within a bucket (urgent first)', () => {
    const groups = groupTasks(
      [
        task({ id: 'low', priority: 'low', dueDate: '2026-09-08' }),
        task({ id: 'urgent', priority: 'urgent', dueDate: '2026-09-08' }),
        task({ id: 'high', priority: 'high', dueDate: '2026-09-08' }),
      ],
      NOW,
    );
    expect(groups.today.map((t) => t.id)).toEqual(['urgent', 'high', 'low']);
  });

  it('treats an unexpired snooze as not-yet-due', () => {
    const groups = groupTasks(
      [task({ id: 's', dueDate: '2026-09-05', snoozedUntil: '2026-09-10T12:00:00Z' })],
      NOW,
    );
    expect(groups.overdue).toEqual([]);
    expect(groups.upcoming.map((t) => t.id)).toEqual(['s']);
  });
});

describe('dueLabel', () => {
  it('humanizes relative days and appends specific times', () => {
    expect(dueLabel(task({ dueDate: '2026-09-08' }), NOW)).toBe('Today');
    expect(dueLabel(task({ dueDate: '2026-09-09' }), NOW)).toBe('Tomorrow');
    expect(dueLabel(task({ dueDate: '2026-09-05' }), NOW)).toBe('3 days overdue');
    expect(dueLabel(task({ dueAt: '2026-09-08T18:00:00Z' }), NOW)).toContain('2:00');
    expect(dueLabel(task({}), NOW)).toBe('No date');
  });
});

describe('taskDayKey', () => {
  it('prefers the timed due moment, converted to the business day', () => {
    expect(taskDayKey(task({ dueAt: '2026-09-09T03:00:00Z', dueDate: '2026-09-09' }))).toBe('2026-09-08');
    expect(taskDayKey(task({ dueDate: '2026-09-10' }))).toBe('2026-09-10');
  });
});

describe('parseQuickTask', () => {
  it('strips a trailing day word into a due date', () => {
    expect(parseQuickTask('order material friday', NOW)).toEqual({
      title: 'order material',
      dueDate: '2026-09-11',
    });
    expect(parseQuickTask('call GC tomorrow', NOW)).toEqual({ title: 'call GC', dueDate: '2026-09-09' });
    expect(parseQuickTask('review ads today', NOW)).toEqual({ title: 'review ads', dueDate: '2026-09-08' });
  });

  it('says "tuesday" on a Tuesday means NEXT Tuesday', () => {
    expect(parseQuickTask('payroll tuesday', NOW)).toEqual({ title: 'payroll', dueDate: '2026-09-15' });
  });

  it('leaves titles without a day word untouched', () => {
    expect(parseQuickTask('order grinder diamonds', NOW)).toEqual({ title: 'order grinder diamonds' });
  });
});

describe('labelTasks', () => {
  it('attaches labels from loaded records by entity', () => {
    const [a, b] = labelTasks(
      [
        task({ id: 'a', entityType: 'job', entityId: 'j1' }),
        task({ id: 'b', entityType: 'quote', entityId: 'q1' }),
      ],
      {
        jobs: [{ id: 'j1', title: 'Warehouse floor', clientName: 'Kettle' }],
        quotes: [{ id: 'q1', number: 'Q-264', clientName: 'Peter' }],
      },
    );
    expect(a.entityLabel).toBe('Warehouse floor');
    expect(b.entityLabel).toBe('Quote Q-264 · Peter');
  });
});
