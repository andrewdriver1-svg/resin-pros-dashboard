'use client';

/**
 * Owner judgment controls for a lead candidate. The system detects; the owner
 * decides. Nothing here writes to Jobber or the mailbox — a candidate becomes
 * real work only when the owner spawns a follow-up task or links a customer.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewLeadCandidate } from '@/lib/actions/ops';

export interface CustomerOption {
  id: string;
  name: string;
}

export function CandidateActions({ id, customers }: { id: string; customers: CustomerOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [customerId, setCustomerId] = useState('');

  const run = (action: 'dismiss' | 'mark_reviewed' | 'create_task' | 'link_customer', extra?: { customerId?: string }) =>
    startTransition(async () => {
      setError(null);
      const res = await reviewLeadCandidate({ id, action, ...extra });
      if (!res.ok) setError(res.message ?? 'Action failed.');
      else {
        setLinking(false);
        router.refresh();
      }
    });

  const btn =
    'inline-flex min-h-9 items-center rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-accent/50 hover:text-accent disabled:opacity-50';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => run('create_task')} className={`${btn} border-accent/40 text-accent`}>
          Create follow-up task
        </button>
        {customers.length > 0 && (
          <button type="button" disabled={pending} onClick={() => setLinking((v) => !v)} className={btn} aria-expanded={linking}>
            Link customer
          </button>
        )}
        <button type="button" disabled={pending} onClick={() => run('mark_reviewed')} className={btn}>
          Mark reviewed
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run('dismiss')}
          className="inline-flex min-h-9 items-center rounded-lg px-3 py-1.5 text-xs font-medium text-ink-4 transition hover:text-bad disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>
      {linking && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="min-h-9 rounded-lg border border-edge bg-panel-2 px-2 py-1.5 text-xs text-ink"
            aria-label="Customer to link"
          >
            <option value="">Choose customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !customerId}
            onClick={() => run('link_customer', { customerId })}
            className={btn}
          >
            Link
          </button>
        </div>
      )}
      {error && (
        <p className="text-xs text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
