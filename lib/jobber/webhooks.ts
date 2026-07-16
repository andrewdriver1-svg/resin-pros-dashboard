/**
 * Jobber webhook helpers. Jobber signs each webhook payload with an HMAC-SHA256
 * of the raw request body using your app secret, base64-encoded in the
 * `X-Jobber-Hmac-SHA256` header. We verify with a constant-time compare.
 */

import crypto from 'node:crypto';

export const JOBBER_HMAC_HEADER = 'x-jobber-hmac-sha256';

/** Compute the expected base64 HMAC-SHA256 signature for a raw body. */
export function computeSignature(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
}

/**
 * Verify a webhook signature in constant time. Returns false (never throws) on
 * any malformed input so the route can respond 401 cleanly.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = computeSignature(rawBody, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Topics Jobber sends that should trigger a resync. */
export interface JobberWebhookPayload {
  topic?: string;
  itemId?: string;
  accountId?: string;
}

export function parseWebhookPayload(rawBody: string): JobberWebhookPayload {
  try {
    const json = JSON.parse(rawBody) as { data?: { webHookEvent?: JobberWebhookPayload } } & JobberWebhookPayload;
    // Jobber nests the event under data.webHookEvent; tolerate a flat shape too.
    return json.data?.webHookEvent ?? { topic: json.topic, itemId: json.itemId, accountId: json.accountId };
  } catch {
    return {};
  }
}
