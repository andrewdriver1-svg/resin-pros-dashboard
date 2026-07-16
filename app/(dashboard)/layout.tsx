import { redirect } from 'next/navigation';
import { businessConfig } from '@/config/business.config';
import { getSessionState } from '@/lib/auth/session';
import { Shell } from '@/app/components/shell';
import { SignOutButton } from '@/app/components/SignOutButton';

function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-slate-900">{businessConfig.displayName}</div>
      <div className="text-xs text-slate-500">{subtitle ?? 'Operations'}</div>
    </div>
  );
}

/**
 * Dashboard shell + access gate.
 *  - Not signed in (configured mode): bounce to /login (middleware normally does
 *    this; this is a belt-and-suspenders fallback).
 *  - Signed in but no business_members row: show a friendly "account not linked"
 *    page — this is the real first-login experience for both owners.
 *  - Otherwise: render the dashboard.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionState();

  if (!session.signedIn) redirect('/login');

  if (!session.linked) {
    return <AccountNotLinked email={session.email} />;
  }

  return (
    <Shell
      brand={<Brand subtitle={session.businessName ?? 'Operations'} />}
      footer={
        <div className="space-y-2">
          {session.email && (
            <div className="truncate px-3 text-xs text-slate-400" title={session.email}>
              {session.email}
            </div>
          )}
          {!session.fixtureMode && <SignOutButton />}
        </div>
      }
    >
      {children}
    </Shell>
  );
}

function AccountNotLinked({ email }: { email: string | null }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-3 text-4xl" aria-hidden>
          🔑
        </div>
        <h1 className="text-lg font-semibold text-slate-900">Your account isn&apos;t linked yet</h1>
        <p className="mt-2 text-sm text-slate-500">
          You&apos;re signed in{email ? ` as ${email}` : ''}, but this account isn&apos;t connected to{' '}
          {businessConfig.legalName} yet. Ask the other owner to add you, or link this account by
          adding a <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">business_members</code>{' '}
          row in Supabase (see README → &ldquo;Linking the two owners&rdquo;).
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
