'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { businessConfig } from '@/config/business.config';

/**
 * Passwordless login. Sends a Supabase magic link to the owner's email. The link
 * lands on /auth/callback, which establishes the session and forwards to the
 * dashboard.
 */
export default function LoginPage() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    setMessage('');
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold text-slate-900">{businessConfig.displayName}</div>
          <div className="text-sm text-slate-500">Operations Dashboard</div>
        </div>

        {!configured ? (
          <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
            Supabase isn&apos;t configured yet, so sign-in is disabled. The dashboard is running on
            sample data — set the Supabase environment variables to enable login. See README.
          </div>
        ) : status === 'sent' ? (
          <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
            Check your inbox — we sent a sign-in link to <strong>{email}</strong>. It expires shortly.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Work email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@resinprosflooring.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
              />
            </label>
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending link…' : 'Email me a sign-in link'}
            </button>
            {status === 'error' && <p className="text-sm text-red-600">{message}</p>}
          </form>
        )}
        <p className="mt-6 text-center text-xs text-slate-400">Internal tool · authorized users only</p>
      </div>
    </main>
  );
}
