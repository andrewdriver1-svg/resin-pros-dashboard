import { NextResponse, type NextRequest } from 'next/server';
import {
  clearQuickBooksTokens,
  isQuickBooksConfigured,
  loadQuickBooksTokens,
  revokeQuickBooksToken,
} from '@/lib/quickbooks/client';

export const runtime = 'nodejs';

/**
 * Disconnect QuickBooks. Revokes the grant at Intuit (so the connection also
 * disappears from the customer's QuickBooks "My Apps" list) and forgets the
 * stored tokens locally.
 *
 * Local state is cleared even if the remote revoke fails — otherwise a
 * connection Intuit already dropped would be stuck "connected" forever, with no
 * way for the owner to re-authorize.
 */
export async function POST(request: NextRequest) {
  const settings = (reason: string) =>
    NextResponse.redirect(new URL(`/settings?quickbooks=${reason}`, request.url), {
      // 303 so the browser follows the redirect with GET, not POST.
      status: 303,
    });

  if (!isQuickBooksConfigured()) return settings('unconfigured');

  const tokens = await loadQuickBooksTokens();
  if (!tokens?.refreshToken) {
    await clearQuickBooksTokens();
    return settings('disconnected');
  }

  let reason = 'disconnected';
  try {
    await revokeQuickBooksToken(tokens.refreshToken);
  } catch (err) {
    console.error('[quickbooks] revoke failed:', (err as Error).message);
    reason = 'disconnected-local';
  }
  await clearQuickBooksTokens();
  return settings(reason);
}
