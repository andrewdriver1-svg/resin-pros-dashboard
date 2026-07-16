import { NextResponse, type NextRequest } from 'next/server';
import { syncAll } from '@/lib/jobber/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Scheduled reconciliation — the fallback for missed webhooks. Wire this to a
 * cron (e.g. Vercel Cron) that sends `Authorization: Bearer $CRON_SECRET`.
 * Does a full idempotent resync.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET ?? '';
  const auth = request.headers.get('authorization');

  // If a secret is configured, require it. (Vercel Cron sends it automatically.)
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const result = await syncAll();
  const ok = result.errors.length === 0;
  return NextResponse.json({ ok, ...result }, { status: ok ? 200 : 207 });
}
