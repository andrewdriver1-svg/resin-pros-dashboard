import { NextResponse, type NextRequest } from 'next/server';
import { GmailClient, exchangeEmailCode, isEmailConfigured, saveEmailAccount } from '@/lib/email/gmail';

export const runtime = 'nodejs';

/**
 * Google OAuth redirect target. Validates CSRF state, exchanges the code,
 * persists tokens (service role), and records the connected address. Errors
 * land back on Settings with a reason.
 */
export async function GET(request: NextRequest) {
  const settings = (reason: string) => NextResponse.redirect(new URL(`/settings?email=${reason}`, request.url));

  if (!isEmailConfigured()) return settings('unconfigured');

  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const cookieState = request.cookies.get('email_oauth_state')?.value;

  if (searchParams.get('error')) return settings('denied');
  if (!code || !state || !cookieState || state !== cookieState) return settings('badstate');

  try {
    const tokens = await exchangeEmailCode(code);
    await saveEmailAccount('', tokens);
    // Resolve the mailbox address for display; non-fatal if it fails.
    try {
      const client = await GmailClient.fromStoredTokens();
      const profile = await client?.profile();
      if (profile?.emailAddress) await saveEmailAccount(profile.emailAddress, tokens);
    } catch {
      /* address stays blank; sync still works */
    }
  } catch (err) {
    console.error('[email] OAuth callback failed:', (err as Error).message);
    return settings('error');
  }

  const response = settings('connected');
  response.cookies.delete('email_oauth_state');
  return response;
}
