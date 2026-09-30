import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { getEmailAuthorizeUrl, isEmailConfigured } from '@/lib/email/gmail';

export const runtime = 'nodejs';

/**
 * Kick off the Gmail OAuth flow (READ-ONLY scope). CSRF state in a short-lived
 * cookie, then Google's consent screen. Requires GOOGLE_CLIENT_ID/SECRET.
 */
export function GET(request: NextRequest) {
  if (!isEmailConfigured()) {
    return NextResponse.redirect(new URL('/settings?email=unconfigured', request.url));
  }
  const state = crypto.randomBytes(16).toString('hex');
  const response = NextResponse.redirect(getEmailAuthorizeUrl(state));
  response.cookies.set('email_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return response;
}
