'use client';

/**
 * Stale-pipeline review: rapid INTERNAL classification of an open quote.
 * Never touches the quote in Jobber — the raw pipeline number stays intact;
 * the adjusted pipeline simply stops counting likely_dead / known_lost.
 * "Follow up" also opens a prefilled, quote-linked task.
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { classifyQuote } from '@/lib/actions/ops';
import type { QuoteClassification } from '@/lib/db/types';
import { shiftBusinessDay } from '@/lib/tasks';
import { openTaskForm } from './os-events';

const OPTIONS: { value: QuoteClassification; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'follow_up', label: 'Follow up' },
  { value: 'likely_dead', label: 'Likely dead' },
  { value: 'known_lost', label: 'Known lost' },
  { value: 'needs_research', label: 'Needs research' },
];

export function QuoteReviewControls({
  quoteId,
  quoteNumber,
  clientName,
  current,
}: {
  quoteId: string;
  quoteNumber: string;
  clientName: string;
  current?: QuoteClassification;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const classify = (classification: QuoteClassification) => {
    startTransition(async () => {
      await classifyQuote({ quoteId, classification });
      if (classification === 'follow_up') {
        openTaskForm({
          title: `Follow up Quote ${quoteNumber} — ${clientName}`,
          dueDate: shiftBusinessDay(1),
          entityType: 'quote',
          entityId: quoteId,
          entityLabel: `Quote ${quoteNumber} · ${clientName}`,
        });
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {OPTIONS.map((o) => {
        const active = current === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={pending}
            onClick={() => classify(o.value)}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors duration-150 disabled:opacity-50 ${
              active
                ? o.value === 'active' || o.value === 'follow_up'
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                  : o.value === 'needs_research'
                    ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                    : 'border-edge bg-panel-2 text-ink-3'
                : 'border-edge text-ink-4 hover:border-accent/50 hover:text-ink-2'
            }`}
            aria-pressed={active}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
