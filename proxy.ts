import type { NextRequest } from 'next/server';
import { proxyGate } from '@/lib/auth/proxy';

/**
 * Next.js 16 "proxy" convention (formerly middleware). Delegates to the auth gate
 * in lib/auth/proxy.ts. In fixture mode it passes everything through; configured,
 * it requires a signed-in Supabase user for dashboard routes.
 */
export function proxy(request: NextRequest) {
  return proxyGate(request);
}

export const config = {
  // Gate everything except static assets and API routes. API routes (Jobber
  // webhook, cron, OAuth callback) authenticate themselves via secret/service role.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
