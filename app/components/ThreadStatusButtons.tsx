'use client';

/**
 * Review controls for an email thread — internal state only (open / reviewed /
 * dismissed). Never touches the mailbox: the Gmail connection cannot write.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setEmailThreadStatus } from '@/lib/actions/ops';

export function ThreadStatusButtons({ threadId, status }: { threadId: string; status: 'open' | 'reviewed' | 'dismissed' }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const set = (next: 'open' | 'reviewed' | 'dismissed') =>
    startTransition(async () => {
      setError(null);
      const res = await setEmailThreadStatus({ threadId, status: next });
      if (!res.ok) setError(res.message ?? 'Failed.');
      else router.refresh();
    });

  return (
    <div className="flex items-center gap-2">
      {status !== 'reviewed' && (
        <button
          type="button"
          disabled={pending}
          onClick={() => set('reviewed')}
          className="inline-flex min-h-9 items-center rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:border-accent/50 hover:text-accent disabled:opacity-50"
        >
          Mark reviewed
        </button>
      )}
      {status !== 'dismissed' ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => set('dismissed')}
          className="inline-flex min-h-9 items-center rounded-lg px-3 py-1.5 text-xs font-medium text-ink-4 transition hover:text-bad disabled:opacity-50"
        >
          Dismiss
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => set('open')}
          className="inline-flex min-h-9 items-center rounded-lg px-3 py-1.5 text-xs font-medium text-ink-4 transition hover:text-ink-2 disabled:opacity-50"
        >
          Reopen
        </button>
      )}
      {error && (
        <span className="text-xs text-bad" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
