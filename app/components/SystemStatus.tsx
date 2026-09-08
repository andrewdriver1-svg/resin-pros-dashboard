/**
 * Data trust surfaces (server-rendered).
 *
 * SystemStatus: a subtle "● Systems" indicator with per-source freshness —
 * Jobber (proxied by the newest synced row's updated_at), QuickBooks (its
 * recorded last_synced_at, read server-side via the service role), and the
 * internal database (a live probe). Quiet when healthy, amber when stale,
 * red when unreachable.
 *
 * DataTrustBanner: shown ONLY when the live database is unreachable in
 * production — the app then shows empty sections, never sample data, and this
 * banner says so plainly.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { probeDatabase } from '@/lib/db';
import { relativeTime } from './format';

interface SourceStatus {
  name: string;
  detail: string;
  tone: 'good' | 'warn' | 'bad' | 'muted';
}

const STALE_JOBBER_MS = 36 * 3_600_000; // cron is hourly-ish; 36h means it's broken
const STALE_QBO_MS = 48 * 3_600_000;

async function getStatuses(): Promise<{ sources: SourceStatus[]; worst: 'good' | 'warn' | 'bad' }> {
  if (!isSupabaseConfigured()) {
    return {
      sources: [{ name: 'Demo mode', detail: 'Running on sample data (no database configured).', tone: 'warn' }],
      worst: 'warn',
    };
  }

  const sources: SourceStatus[] = [];
  const probe = await probeDatabase();
  sources.push({
    name: 'Internal',
    detail: probe.ok ? 'Live' : `Unreachable — ${probe.error ?? 'unknown error'}`,
    tone: probe.ok ? 'good' : 'bad',
  });

  if (probe.ok) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase
        .from('jobs')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const at = data?.updated_at ? new Date(data.updated_at as string).getTime() : null;
      sources.push({
        name: 'Jobber',
        detail: at ? `Synced ${relativeTime(new Date(at).toISOString())}` : 'No synced data yet',
        tone: at ? (Date.now() - at > STALE_JOBBER_MS ? 'warn' : 'good') : 'muted',
      });
    } catch {
      sources.push({ name: 'Jobber', detail: 'Freshness unknown', tone: 'muted' });
    }

    try {
      const admin = createSupabaseAdminClient();
      if (admin) {
        const { data } = await admin.from('quickbooks_oauth').select('last_synced_at').eq('id', 'primary').maybeSingle();
        const at = data?.last_synced_at ? new Date(data.last_synced_at as string).getTime() : null;
        sources.push({
          name: 'QuickBooks',
          detail: at ? `Synced ${relativeTime(new Date(at).toISOString())}` : 'Not connected',
          tone: at ? (Date.now() - at > STALE_QBO_MS ? 'warn' : 'good') : 'muted',
        });
      }
    } catch {
      sources.push({ name: 'QuickBooks', detail: 'Freshness unknown', tone: 'muted' });
    }
  }

  const worst = sources.some((s) => s.tone === 'bad') ? 'bad' : sources.some((s) => s.tone === 'warn') ? 'warn' : 'good';
  return { sources, worst };
}

const DOT: Record<string, string> = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad', muted: 'bg-ink-4' };

export async function SystemStatus() {
  const { sources, worst } = await getStatuses();
  return (
    <details className="relative px-3">
      <summary className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-1 py-1 text-xs text-ink-4 hover:text-ink-2 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[worst]}`} />
        {worst === 'good' ? 'Systems healthy' : worst === 'warn' ? 'Systems: check' : 'Systems: issue'}
      </summary>
      <div className="absolute bottom-8 left-3 z-30 w-56 rounded-lg border border-edge bg-panel-2 p-3 shadow-xl">
        <ul className="space-y-1.5">
          {sources.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-ink-2">
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[s.tone]}`} />
                {s.name}
              </span>
              <span className="text-right text-ink-4">{s.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export async function DataTrustBanner() {
  if (!isSupabaseConfigured()) return null; // dev/demo — fixtures are intended
  const probe = await probeDatabase();
  if (probe.ok) return null;
  return (
    <div role="alert" className="border-b border-red-400/30 bg-red-400/10 px-4 py-2.5 text-center text-sm text-red-200">
      <span className="font-semibold">Data issue:</span> live business data is unavailable right now — sections may
      appear empty. Nothing shown is fabricated. ({probe.error ?? 'connection failed'})
    </div>
  );
}
