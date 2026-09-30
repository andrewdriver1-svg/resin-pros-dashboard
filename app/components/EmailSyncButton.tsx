'use client';

/**
 * Owner-triggered email sync — read-only pull from the mailbox, recorded in
 * sync_runs. Mirrors SyncNowButton for Jobber.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { runEmailSyncNow } from '@/lib/actions/ops';

export function EmailSyncButton() {
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
            const res = await runEmailSyncNow();
            if (res.ok && res.counts) {
              setMsg({
                ok: true,
                text: `Scanned ${res.counts.scanned}, ${res.counts.new} new, ${res.counts.relevant} relevant, ${res.counts.candidates} lead candidate${res.counts.candidates === 1 ? '' : 's'}.`,
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
