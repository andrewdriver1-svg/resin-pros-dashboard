import { NextResponse, type NextRequest } from 'next/server';
import { exchangeCodeForTokens, isJobberConfigured, saveJobberTokens } from '@/lib/jobber/client';

export const runtime = 'nodejs';

/**
 * Jobber OAuth redirect target. Validates the CSRF state, exchanges the code for
 * tokens, and persists them. Errors redirect back to Settings with a reason
 * rather than throwing.
 */
export async function GET(request: NextRequest) {
  const settings = (reason: string) => NextResponse.redirect(new URL(`/settings?jobber=${reason}`, request.url));

  if (!isJobberConfigured()) return settings('unconfigured');

  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const cookieState = request.cookies.get('jobber_oauth_state')?.value;

  if (searchParams.get('error')) return settings('denied');
  if (!code || !state || !cookieState || state !== cookieState) return settings('badstate');

  try {
    const tokens = await exchangeCodeForTokens(code);
    await saveJobberTokens(tokens);
  } catch (err) {
    console.error('[jobber] OAuth callback failed:', (err as Error).message);
    return settings('error');
  }

  const response = settings('connected');
  response.cookies.delete('jobber_oauth_state');
  return response;
}
