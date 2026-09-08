'use client';

/**
 * Attention → action in one motion: every attention item can spawn a follow-up
 * task (prefilled, linked to the record) or be acknowledged / snoozed /
 * resolved. States are INTERNAL — Jobber records are never modified by
 * dismissing an alert.
 */

import { useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAttentionState } from '@/lib/actions/ops';
import type { AttentionItem } from '@/lib/insights';
import { openTaskForm } from './os-events';

export function AttentionActions({ item }: { item: AttentionItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDetailsElement>(null);

  const setState = (state: 'acknowledged' | 'snoozed' | 'resolved', snoozeDays?: number) => {
    menuRef.current?.removeAttribute('open');
    startTransition(async () => {
      await setAttentionState({
        itemKey: item.id,
        state,
        snoozedUntil: snoozeDays ? new Date(Date.now() + snoozeDays * 86_400_000).toISOString() : undefined,
      });
      router.refresh();
    });
  };

  const btn =
    'rounded-lg border border-edge px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors duration-150 hover:border-accent/50 hover:text-accent disabled:opacity-50';

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {item.followUp && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            openTaskForm({
              title: item.followUp!.title,
              dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
              entityType: item.followUp!.entityType,
              entityId: item.followUp!.entityId,
              entityLabel: item.title,
            })
          }
          className={btn}
        >
          Follow-up
        </button>
      )}
      <details ref={menuRef} className="relative">
        <summary
          className={`${btn} list-none cursor-pointer select-none [&::-webkit-details-marker]:hidden`}
          aria-label="More actions"
        >
          ⋯
        </summary>
        <div className="absolute right-0 top-9 z-30 w-40 overflow-hidden rounded-lg border border-edge bg-panel shadow-xl">
          {!item.acknowledged && (
            <button type="button" onClick={() => setState('acknowledged')} className="block w-full px-3 py-2 text-left text-xs text-ink-2 hover:bg-panel-2">
              Acknowledge
            </button>
          )}
          <button type="button" onClick={() => setState('snoozed', 1)} className="block w-full px-3 py-2 text-left text-xs text-ink-2 hover:bg-panel-2">
            Snooze until tomorrow
          </button>
          <button type="button" onClick={() => setState('snoozed', 3)} className="block w-full px-3 py-2 text-left text-xs text-ink-2 hover:bg-panel-2">
            Snooze 3 days
          </button>
          <button type="button" onClick={() => setState('snoozed', 7)} className="block w-full px-3 py-2 text-left text-xs text-ink-2 hover:bg-panel-2">
            Snooze 1 week
          </button>
          <button type="button" onClick={() => setState('resolved')} className="block w-full px-3 py-2 text-left text-xs text-good hover:bg-panel-2">
            Resolve
          </button>
        </div>
      </details>
    </div>
  );
}
