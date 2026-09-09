import { Suspense } from 'react';
import { businessConfig } from '@/config/business.config';
import { getGoogleBusinessSnapshot, getSyncRuns } from '@/lib/db';
import { isJobberConfigured, loadJobberTokens } from '@/lib/jobber/client';
import { isQuickBooksConfigured, loadQuickBooksTokens } from '@/lib/quickbooks/client';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { PageHeader, Card } from '@/app/components/ui';
import { TableSkeleton } from '@/app/components/states';
import { GoogleBusinessForm } from '@/app/components/GoogleBusinessForm';
import { SyncNowButton } from '@/app/components/SyncNowButton';

export const dynamic = 'force-dynamic';

/**
 * Human-readable outcomes for the `?jobber=` / `?quickbooks=` query params the
 * OAuth callback routes redirect back with. Without this, every outcome —
 * including "you denied access" and "session expired, try again" — landed on a
 * silent, unchanged page, and the only rational user response was to keep
 * re-tapping Connect.
 */
const OAUTH_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: 'Connected. Data will appear after the next sync.', ok: true },
  disconnected: { text: 'Disconnected, and access was revoked.', ok: true },
  'disconnected-local': {
    text: 'Disconnected here, but revoking access upstream failed — you can also remove the app from the provider’s connected-apps page.',
    ok: false,
  },
  denied: { text: 'Authorization was declined, so nothing was connected.', ok: false },
  badstate: { text: 'The sign-in session expired before finishing. Try Connect again in one go.', ok: false },
  norealm: { text: 'The provider didn’t say which company was authorized. Try Connect again.', ok: false },
  error: { text: 'Connection failed partway through. Try again; if it keeps failing, check the server logs.', ok: false },
  unconfigured: { text: 'OAuth credentials aren’t set on the server, so connecting is disabled.', ok: false },
};

function OAuthNotice({ provider, code }: { provider: string; code: string | undefined }) {
  if (!code) return null;
  const m = OAUTH_MESSAGES[code] ?? { text: `Unexpected status “${code}”.`, ok: false };
  return (
    <div
      role="status"
      className={`rounded-lg border p-3 text-sm ${
        m.ok ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/30 bg-amber-400/10 text-amber-300'
      }`}
    >
      <span className="font-medium">{provider}:</span> {m.text}
    </div>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ jobber?: string; quickbooks?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Integrations and hand-maintained data." />

      <OAuthNotice provider="Jobber" code={params.jobber} />
      <OAuthNotice provider="QuickBooks" code={params.quickbooks} />

      <Card title="Business">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Row label="Legal name" value={businessConfig.legalName} />
          <Row label="Display name" value={businessConfig.displayName} />
          <Row label="Timezone" value={businessConfig.contact.timezone} />
          <Row label="Owners" value={businessConfig.owners.map((o) => o.name).join(', ')} />
        </dl>
        <p className="mt-3 text-xs text-ink-4">Edit these in <code className="rounded bg-panel-2 px-1 py-0.5">config/business.config.ts</code>.</p>
      </Card>

      <Suspense fallback={<TableSkeleton rows={2} />}>
        <JobberCard />
      </Suspense>

      <Suspense fallback={<TableSkeleton rows={2} />}>
        <QuickBooksCard />
      </Suspense>

      <Card title="Google Business Profile & social">
        <p className="mb-4 text-sm text-ink-3">
          There&apos;s no reliable public write API for this data, so update it here by hand every so
          often. The Marketing page and overview read from the latest snapshot.
        </p>
        <Suspense fallback={<TableSkeleton rows={3} />}>
          <GoogleBusinessSection />
        </Suspense>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-ink">{value || '—'}</dd>
    </div>
  );
}

async function JobberCard() {
  const configured = isJobberConfigured();
  const [tokens, runs] = await Promise.all([
    configured ? loadJobberTokens() : Promise.resolve(null),
    getSyncRuns('jobber', 3),
  ]);
  const connected = Boolean(tokens?.accessToken);

  return (
    <Card title="Jobber connection">
      {!configured ? (
        <p className="text-sm text-ink-3">
          Jobber OAuth credentials aren&apos;t set. Add <code className="rounded bg-panel-2 px-1 py-0.5">JOBBER_CLIENT_ID</code> and{' '}
          <code className="rounded bg-panel-2 px-1 py-0.5">JOBBER_CLIENT_SECRET</code> (see README), then connect.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${connected ? 'bg-emerald-400/10 ring-1 ring-inset ring-emerald-400/20 text-emerald-300' : 'bg-amber-400/10 ring-1 ring-inset ring-amber-400/20 text-amber-300'}`}>
                {connected ? 'Connected' : 'Not connected'}
              </span>
              <p className="mt-1 text-ink-3">
                {connected ? 'Jobs, quotes, invoices, and requests sync from Jobber.' : 'Authorize once to start syncing.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {connected && <SyncNowButton />}
              <a
                href="/api/jobber/connect"
                className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface transition hover:bg-accent-soft"
              >
                {connected ? 'Reconnect Jobber' : 'Connect Jobber'}
              </a>
            </div>
          </div>
          {runs.length > 0 && (
            <div className="text-xs text-ink-4">
              <span className="font-semibold uppercase tracking-wide">Recent syncs</span>
              <ul className="mt-1 space-y-0.5">
                {runs.map((r) => (
                  <li key={r.id}>
                    <span className={r.ok ? 'text-good' : 'text-bad'}>{r.ok ? '●' : '●'}</span>{' '}
                    {new Date(r.ranAt).toLocaleString('en-US', { timeZone: businessConfig.contact.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{' '}
                    — {r.ok ? `${r.jobs} jobs · ${r.quotes} quotes · ${r.invoices} invoices · ${r.leads} leads` : r.errors.join('; ') || 'failed'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

async function QuickBooksCard() {
  const configured = isQuickBooksConfigured();
  const tokens = configured ? await loadQuickBooksTokens() : null;
  const connected = Boolean(tokens?.accessToken && tokens?.realmId);

  return (
    <Card title="QuickBooks connection">
      {!configured ? (
        <p className="text-sm text-ink-3">
          QuickBooks OAuth credentials aren&apos;t set. Add <code className="rounded bg-panel-2 px-1 py-0.5">QUICKBOOKS_CLIENT_ID</code> and{' '}
          <code className="rounded bg-panel-2 px-1 py-0.5">QUICKBOOKS_CLIENT_SECRET</code> (see README), then connect.
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${connected ? 'bg-emerald-400/10 ring-1 ring-inset ring-emerald-400/20 text-emerald-300' : 'bg-amber-400/10 ring-1 ring-inset ring-amber-400/20 text-amber-300'}`}>
              {connected ? 'Connected' : 'Not connected'}
            </span>
            <p className="mt-1 text-ink-3">
              {connected
                ? 'Spending syncs from QuickBooks into the Spending page daily.'
                : 'Authorize once to start syncing spending & banking.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {connected && (
              <form action="/api/quickbooks/disconnect" method="post">
                <button
                  type="submit"
                  className="inline-flex items-center rounded-lg border border-edge px-4 py-2 text-sm font-medium text-ink-2 transition hover:bg-panel-2"
                >
                  Disconnect
                </button>
              </form>
            )}
            <a
              href="/api/quickbooks/connect"
              className="inline-flex items-center rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface transition hover:bg-accent-soft"
            >
              {connected ? 'Reconnect QuickBooks' : 'Connect QuickBooks'}
            </a>
          </div>
        </div>
      )}
    </Card>
  );
}

async function GoogleBusinessSection() {
  const snapshot = await getGoogleBusinessSnapshot();
  return (
    <>
      {!isSupabaseConfigured() && (
        <p className="mb-4 rounded-lg bg-amber-400/10 p-3 text-xs text-amber-300">
          Supabase isn&apos;t configured, so saving is disabled — these fields show the sample snapshot.
        </p>
      )}
      <GoogleBusinessForm current={snapshot} />
    </>
  );
}
