'use client';

/**
 * Owner-triggered Jobber sync. Same code path as the cron and webhook — pulls
 * from Jobber, never writes back — and records a sync_runs row, so the Systems
 * indicator reflects the run immediately. Membership-checked server-side.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { runJobberSyncNow } from '@/lib/actions/ops';

export function SyncNowButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMsg(null);
            const res = await runJobberSyncNow();
            if (res.ok && res.counts) {
              setMsg({
                ok: true,
                text: `Synced: ${res.counts.jobs} jobs, ${res.counts.quotes} quotes, ${res.counts.invoices} invoices, ${res.counts.leads} leads, ${res.counts.customers} customers.`,
              });
            } else {
              setMsg({ ok: false, text: res.message ?? 'Sync failed.' });
            }
            router.refresh();
          })
        }
        className="inline-flex items-center rounded-lg border border-edge px-4 py-2 text-sm font-medium text-ink-2 transition hover:border-accent/50 hover:text-accent disabled:opacity-50"
      >
        {pending ? 'Syncing…' : 'Sync now'}
      </button>
      {msg && (
        <span className={`text-xs ${msg.ok ? 'text-good' : 'text-bad'}`} role="status">
          {msg.text}
        </span>
      )}
    </div>
  );
}
