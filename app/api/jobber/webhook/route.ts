import { NextResponse, type NextRequest } from 'next/server';
import { JOBBER_HMAC_HEADER, parseWebhookPayload, verifyWebhookSignature } from '@/lib/jobber/webhooks';
import { syncAll } from '@/lib/jobber/sync';

export const runtime = 'nodejs';

/**
 * Jobber webhook receiver. Verifies the HMAC signature, then triggers a resync.
 *
 * We resync everything rather than surgically patching one record: it's simpler,
 * idempotent (upsert on jobber_id), and the data volume for a two-person shop is
 * tiny. The scheduled cron reconciliation is the backstop if a webhook is missed.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.JOBBER_WEBHOOK_SECRET ?? '';
  const raw = await request.text();
  const signature = request.headers.get(JOBBER_HMAC_HEADER);

  if (!secret) {
    console.error('[jobber] webhook received but JOBBER_WEBHOOK_SECRET is not set.');
    return NextResponse.json({ ok: false, error: 'Webhook not configured.' }, { status: 503 });
  }

  if (!verifyWebhookSignature(raw, signature, secret)) {
    return NextResponse.json({ ok: false, error: 'Invalid signature.' }, { status: 401 });
  }

  const payload = parseWebhookPayload(raw);
  // Respond quickly; run the sync but don't let its failure turn into a 500 that
  // makes Jobber retry indefinitely — the cron job will catch anything missed.
  const result = await syncAll().catch((err) => ({ errors: [(err as Error).message] }));
  if ('errors' in result && result.errors.length > 0) {
    console.warn(`[jobber] webhook sync (topic=${payload.topic ?? '?'}) had issues:`, result.errors);
  }

  return NextResponse.json({ ok: true, topic: payload.topic ?? null });
}
