/**
 * proxy.ts — the auth gate, invoked from middleware.ts on every non-static,
 * non-API request.
 *
 * Behavior:
 *  - Fixture/e2e mode (no Supabase, or E2E_FIXTURE_MODE=1): pass everything
 *    through so the dashboard renders on fixtures with no login. This is what
 *    makes `npm run dev` and the Playwright smoke test work with zero setup.
 *  - Configured mode: refresh the Supabase session cookie, then require a signed-in
 *    user for dashboard routes. Unauthenticated → /login. Signed-in on /login → /.
 *
 * The "is your account linked to a business?" check is deliberately NOT here —
 * it happens in the dashboard layout so we can render a friendly page instead of
 * bouncing the user around.
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isFixtureMode } from '@/lib/supabase/env';

function isPublicPath(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/auth');
}

export async function proxyGate(request: NextRequest): Promise<NextResponse> {
  if (isFixtureMode()) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // IMPORTANT: getUser() also refreshes the session and writes cookies via setAll.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
