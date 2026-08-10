import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { getQuickBooksAuthorizeUrl, isQuickBooksConfigured } from '@/lib/quickbooks/client';

export const runtime = 'nodejs';

/**
 * Kick off the QuickBooks OAuth flow. Generates a CSRF `state`, stores it in a
 * short-lived cookie, and redirects to Intuit's consent screen.
 */
export function GET(request: NextRequest) {
  if (!isQuickBooksConfigured()) {
    return NextResponse.redirect(new URL('/settings?quickbooks=unconfigured', request.url));
  }
  const state = crypto.randomBytes(16).toString('hex');
  const response = NextResponse.redirect(getQuickBooksAuthorizeUrl(state));
  response.cookies.set('quickbooks_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return response;
}
