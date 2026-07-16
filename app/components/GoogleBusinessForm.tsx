'use client';

import { useActionState } from 'react';
import { updateGoogleBusinessSnapshot, type GoogleBusinessFormState } from '@/lib/actions/google-business';
import type { GoogleBusinessSnapshot } from '@/lib/db/types';
import { formatDateTime } from './format';

const initial: GoogleBusinessFormState = { ok: false, message: '' };

/**
 * Hand-maintained Google Business Profile + social snapshot. There's no reliable
 * public write API for this data, so Andrew updates it here periodically. Submits
 * to a server action that inserts a new snapshot row.
 */
export function GoogleBusinessForm({ current }: { current: GoogleBusinessSnapshot }) {
  const [state, action, pending] = useActionState(updateGoogleBusinessSnapshot, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Google rating (0–5)" name="rating" type="number" step="0.1" min="0" max="5" defaultValue={current.rating} />
        <Field label="Review count" name="review_count" type="number" min="0" defaultValue={current.reviewCount} />
        <Field label="Public phone" name="phone" type="text" defaultValue={current.phone} />
        <Field label="Hours" name="hours" type="text" defaultValue={current.hours} />
        <Field label="Facebook followers" name="facebook_followers" type="number" min="0" defaultValue={current.facebookFollowers} />
        <Field label="Instagram followers" name="instagram_followers" type="number" min="0" defaultValue={current.instagramFollowers} />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="profile_strength_ok" defaultChecked={current.profileStrengthOk} className="h-4 w-4 rounded border-slate-300" />
        Profile is complete / in good standing
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save snapshot'}
        </button>
        <span className="text-xs text-slate-400">Last updated {formatDateTime(current.updatedAt)}</span>
      </div>

      {state.message && (
        <p className={`text-sm ${state.ok ? 'text-emerald-700' : 'text-amber-700'}`}>{state.message}</p>
      )}
    </form>
  );
}

function Field({
  label,
  name,
  type,
  defaultValue,
  ...rest
}: {
  label: string;
  name: string;
  type: string;
  defaultValue: string | number;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
        {...rest}
      />
    </label>
  );
}
