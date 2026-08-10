import { Suspense } from 'react';
import { businessConfig } from '@/config/business.config';
import { getGoogleBusinessSnapshot } from '@/lib/db';
import { isJobberConfigured, loadJobberTokens } from '@/lib/jobber/client';
import { isQuickBooksConfigured, loadQuickBooksTokens } from '@/lib/quickbooks/client';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { PageHeader, Card } from '@/app/components/ui';
import { TableSkeleton } from '@/app/components/states';
import { GoogleBusinessForm } from '@/app/components/GoogleBusinessForm';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Integrations and hand-maintained data." />

      <Card title="Business">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Row label="Legal name" value={businessConfig.legalName} />
          <Row label="Display name" value={businessConfig.displayName} />
          <Row label="Timezone" value={businessConfig.contact.timezone} />
          <Row label="Owners" value={businessConfig.owners.map((o) => o.name).join(', ')} />
        </dl>
        <p className="mt-3 text-xs text-slate-400">Edit these in <code className="rounded bg-slate-100 px-1 py-0.5">config/business.config.ts</code>.</p>
      </Card>

      <Suspense fallback={<TableSkeleton rows={2} />}>
        <JobberCard />
      </Suspense>

      <Suspense fallback={<TableSkeleton rows={2} />}>
        <QuickBooksCard />
      </Suspense>

      <Card title="Google Business Profile & social">
        <p className="mb-4 text-sm text-slate-500">
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
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value || '—'}</dd>
    </div>
  );
}

async function JobberCard() {
  const configured = isJobberConfigured();
  const tokens = configured ? await loadJobberTokens() : null;
  const connected = Boolean(tokens?.accessToken);

  return (
    <Card title="Jobber connection">
      {!configured ? (
        <p className="text-sm text-slate-500">
          Jobber OAuth credentials aren&apos;t set. Add <code className="rounded bg-slate-100 px-1 py-0.5">JOBBER_CLIENT_ID</code> and{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5">JOBBER_CLIENT_SECRET</code> (see README), then connect.
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${connected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {connected ? 'Connected' : 'Not connected'}
            </span>
            <p className="mt-1 text-slate-500">
              {connected ? 'Jobs, quotes, invoices, and requests sync from Jobber.' : 'Authorize once to start syncing.'}
            </p>
          </div>
          <a
            href="/api/jobber/connect"
            className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            {connected ? 'Reconnect Jobber' : 'Connect Jobber'}
          </a>
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
        <p className="text-sm text-slate-500">
          QuickBooks OAuth credentials aren&apos;t set. Add <code className="rounded bg-slate-100 px-1 py-0.5">QUICKBOOKS_CLIENT_ID</code> and{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5">QUICKBOOKS_CLIENT_SECRET</code> (see README), then connect.
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${connected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {connected ? 'Connected' : 'Not connected'}
            </span>
            <p className="mt-1 text-slate-500">
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
                  className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Disconnect
                </button>
              </form>
            )}
            <a
              href="/api/quickbooks/connect"
              className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
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
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          Supabase isn&apos;t configured, so saving is disabled — these fields show the sample snapshot.
        </p>
      )}
      <GoogleBusinessForm current={snapshot} />
    </>
  );
}
