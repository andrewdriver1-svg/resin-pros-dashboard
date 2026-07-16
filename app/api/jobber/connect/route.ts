import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { getAuthorizeUrl, isJobberConfigured } from '@/lib/jobber/client';

export const runtime = 'nodejs';

/**
 * Kick off the Jobber OAuth flow. Generates a CSRF `state`, stores it in a
 * short-lived cookie, and redirects to Jobber's consent screen.
 */
export function GET(request: NextRequest) {
  if (!isJobberConfigured()) {
    return NextResponse.redirect(new URL('/settings?jobber=unconfigured', request.url));
  }
  const state = crypto.randomBytes(16).toString('hex');
  const response = NextResponse.redirect(getAuthorizeUrl(state));
  response.cookies.set('jobber_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return response;
}
