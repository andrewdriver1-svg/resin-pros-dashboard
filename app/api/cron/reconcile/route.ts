import { NextResponse, type NextRequest } from 'next/server';
import { syncAll } from '@/lib/jobber/sync';
import { isQuickBooksConfigured } from '@/lib/quickbooks/client';
import { syncQuickBooks, type QuickBooksSyncResult } from '@/lib/quickbooks/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Scheduled reconciliation — the fallback for missed webhooks. Wire this to a
 * cron (e.g. Vercel Cron) that sends `Authorization: Bearer $CRON_SECRET`.
 * Does a full idempotent resync of Jobber, plus QuickBooks spending when that
 * integration is configured. Also keeps the QuickBooks refresh token alive
 * (Intuit expires them after ~100 days without use).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  const auth = request.headers.get('authorization');

  // If a secret is configured, require it. (Vercel Cron sends it automatically.)
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const result = await syncAll();

  let quickbooks: QuickBooksSyncResult | null = null;
  if (isQuickBooksConfigured()) {
    quickbooks = await syncQuickBooks();
    // "not connected" just means Andrew hasn't clicked Connect yet — not an error.
    quickbooks.errors = quickbooks.errors.filter((e) => e !== 'QuickBooks is not connected.');
  }

  const ok = result.errors.length === 0 && (quickbooks?.errors.length ?? 0) === 0;
  return NextResponse.json({ ok, ...result, quickbooks }, { status: ok ? 200 : 207 });
}
