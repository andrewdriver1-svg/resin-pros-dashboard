import { NextResponse, type NextRequest } from 'next/server';
import {
  exchangeQuickBooksCode,
  isQuickBooksConfigured,
  saveQuickBooksTokens,
} from '@/lib/quickbooks/client';

export const runtime = 'nodejs';

/**
 * QuickBooks OAuth redirect target. Validates the CSRF state, exchanges the
 * code for tokens (capturing the realmId — the QuickBooks company id), and
 * persists them. Errors redirect back to Settings with a reason.
 */
export async function GET(request: NextRequest) {
  const settings = (reason: string) =>
    NextResponse.redirect(new URL(`/settings?quickbooks=${reason}`, request.url));

  if (!isQuickBooksConfigured()) return settings('unconfigured');

  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const realmId = searchParams.get('realmId');
  const cookieState = request.cookies.get('quickbooks_oauth_state')?.value;

  if (searchParams.get('error')) return settings('denied');
  if (!code || !state || !cookieState || state !== cookieState) return settings('badstate');
  if (!realmId) return settings('norealm');

  try {
    const tokens = await exchangeQuickBooksCode(code, realmId);
    await saveQuickBooksTokens(tokens);
  } catch (err) {
    console.error('[quickbooks] OAuth callback failed:', (err as Error).message);
    return settings('error');
  }

  const response = settings('connected');
  response.cookies.delete('quickbooks_oauth_state');
  return response;
}
