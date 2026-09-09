'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addNote } from '@/lib/actions/ops';
import { openTaskForm } from '@/app/components/os-events';

export function AddCustomerTaskButton({ customerId, name }: { customerId: string; name: string }) {
  return (
    <button
      type="button"
      onClick={() => openTaskForm({ entityType: 'customer', entityId: customerId, entityLabel: `Customer: ${name}` })}
      className="text-xs font-medium text-accent hover:underline"
    >
      + Add task
    </button>
  );
}

export function CustomerNoteForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!body.trim() || pending) return;
    startTransition(async () => {
      const res = await addNote({ entityType: 'customer', entityId: customerId, body: body.trim() });
      if (!res.ok) setMsg(res.message ?? 'Couldn’t save the note.');
      else {
        setBody('');
        setMsg(null);
      }
      router.refresh();
    });
  };

  return (
    <div className="mt-3">
      <div className="flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Add an internal note (never synced to Jobber)…"
          className="w-full rounded-lg border border-edge bg-panel-2/50 px-3 py-2 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          disabled={pending || !body.trim()}
          onClick={submit}
          className="shrink-0 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-surface transition hover:bg-accent-soft disabled:opacity-50"
        >
          {pending ? '…' : 'Add'}
        </button>
      </div>
      {msg && <p className="mt-1 text-xs text-bad">{msg}</p>}
    </div>
  );
}
