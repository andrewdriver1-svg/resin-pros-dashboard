'use client';

/**
 * Week view — time-block grid, 6 AM–8 PM. One schedule from three sources:
 * internal events + tasks (draggable to reschedule) and Jobber jobs (locked,
 * visually marked — we never write Jobber scheduling from here). Dropping an
 * item on a day/hour updates the SAME underlying record everywhere.
 */

import { useState, useTransition, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { rescheduleEvent, updateTask } from '@/lib/actions/ops';
import { dayKeyAndMinutesToIso, type CalendarItem } from '@/lib/calendar';
import { openDrawer } from './os-events';
import type { Task } from '@/lib/tasks';

const START_HOUR = 6;
const END_HOUR = 20;
const SPAN_MIN = (END_HOUR - START_HOUR) * 60;

const TYPE_STYLE: Record<CalendarItem['type'], string> = {
  personal: 'border-violet-400/40 bg-violet-400/10 text-violet-200',
  meeting: 'border-sky-400/40 bg-sky-400/10 text-sky-200',
  blocked: 'border-edge bg-panel-2 text-ink-3',
  reminder: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
  business: 'border-sky-400/40 bg-sky-400/10 text-sky-200',
  job: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
  task: 'border-edge bg-panel-2/80 text-ink-2',
};

function DayLabel({ dayKey, todayKey }: { dayKey: string; todayKey: string }) {
  const d = new Date(`${dayKey}T12:00:00Z`);
  const isToday = dayKey === todayKey;
  return (
    <div className={`px-1 pb-2 text-center text-xs ${isToday ? 'font-semibold text-accent' : 'text-ink-3'}`}>
      {new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d)}{' '}
      <span className="tabular-nums">{Number(dayKey.slice(8))}</span>
    </div>
  );
}

export function CalendarWeek({
  days,
  items,
  tasksById,
  todayKey,
}: {
  days: string[];
  items: CalendarItem[];
  /** Full task objects so drops/clicks can act on the real record. */
  tasksById: Record<string, Task>;
  todayKey: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ day: string; hour: number } | null>(null);

  const onDrop = (day: string, hour: number) => {
    const item = items.find((i) => i.id === dragId);
    setDragId(null);
    setHover(null);
    if (!item || item.locked) return;
    const iso = dayKeyAndMinutesToIso(day, hour * 60);
    startTransition(async () => {
      if (item.source === 'task') await updateTask({ id: item.sourceId, dueAt: iso });
      else if (item.source === 'event') await rescheduleEvent({ id: item.sourceId, startsAt: iso });
      router.refresh();
    });
  };

  const openItem = (item: CalendarItem) => {
    if (item.source === 'task') {
      const task = tasksById[item.sourceId];
      if (task) openDrawer({ kind: 'task', task });
    }
  };

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  return (
    <div className="table-scroll overflow-x-auto">
      <div className="min-w-[52rem]">
        {/* headers + all-day row */}
        <div className="grid grid-cols-[3rem_repeat(7,1fr)]">
          <div />
          {days.map((d) => (
            <DayLabel key={d} dayKey={d} todayKey={todayKey} />
          ))}
          <div className="pr-1 pt-1 text-right text-[10px] text-ink-4">all-day</div>
          {days.map((d) => (
            <div key={`ad-${d}`} className="min-h-9 space-y-1 border-l border-edge-soft px-1 py-1">
              {items
                .filter((i) => i.dayKey === d && i.startMin == null)
                .map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    draggable={!i.locked}
                    onDragStart={() => setDragId(i.id)}
                    onClick={() => openItem(i)}
                    className={`block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] leading-tight ${TYPE_STYLE[i.type]} ${
                      i.done ? 'line-through opacity-50' : ''
                    } ${i.locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
                    title={`${i.title}${i.locked ? ' (synced from Jobber — read-only)' : ''}`}
                  >
                    {i.locked && <span aria-hidden>🔒 </span>}
                    {i.title}
                  </button>
                ))}
            </div>
          ))}
        </div>

        {/* time grid */}
        <div className="grid grid-cols-[3rem_repeat(7,1fr)] border-t border-edge-soft">
          {/* hour gutter */}
          <div className="relative" style={{ height: `${SPAN_MIN * 0.75}px` }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] tabular-nums text-ink-4" style={{ top: `${(((h - START_HOUR) * 60) / SPAN_MIN) * 100}%` }}>
                {h % 12 === 0 ? 12 : h % 12}
                {h < 12 ? 'a' : 'p'}
              </div>
            ))}
          </div>
          {days.map((d) => (
            <div key={`col-${d}`} className={`relative border-l border-edge-soft ${d === todayKey ? 'bg-sky-400/[0.03]' : ''}`} style={{ height: `${SPAN_MIN * 0.75}px` }}>
              {/* hour drop cells */}
              {hours.map((h) => (
                <div
                  key={h}
                  onDragOver={(e: DragEvent) => {
                    if (!dragId) return;
                    e.preventDefault();
                    setHover({ day: d, hour: h });
                  }}
                  onDrop={() => onDrop(d, h)}
                  className={`absolute inset-x-0 border-t border-edge-soft/60 ${
                    hover && hover.day === d && hover.hour === h ? 'bg-accent/10' : ''
                  }`}
                  style={{ top: `${(((h - START_HOUR) * 60) / SPAN_MIN) * 100}%`, height: `${(60 / SPAN_MIN) * 100}%` }}
                />
              ))}
              {/* timed items */}
              {items
                .filter((i) => i.dayKey === d && i.startMin != null)
                .map((i) => {
                  const top = Math.max(0, ((i.startMin! - START_HOUR * 60) / SPAN_MIN) * 100);
                  const height = Math.min(100 - top, (i.durationMin / SPAN_MIN) * 100);
                  return (
                    <button
                      key={i.id}
                      type="button"
                      draggable={!i.locked}
                      onDragStart={() => setDragId(i.id)}
                      onClick={() => openItem(i)}
                      className={`absolute inset-x-0.5 overflow-hidden rounded border px-1.5 py-0.5 text-left text-[11px] leading-tight ${TYPE_STYLE[i.type]} ${
                        i.done ? 'line-through opacity-50' : ''
                      } ${i.locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
                      style={{ top: `${top}%`, height: `${Math.max(height, 3)}%` }}
                      title={`${i.title}${i.locked ? ' (synced from Jobber — read-only)' : ''}`}
                    >
                      {i.locked && <span aria-hidden>🔒 </span>}
                      <span className="font-medium">{i.title}</span>
                      {i.subtitle && <span className="block truncate opacity-70">{i.subtitle}</span>}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-ink-4">
        Drag internal events and tasks to reschedule. 🔒 items are synced from Jobber and read-only here.
      </p>
    </div>
  );
}
