import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

/**
 * Supabase client bound to the request's cookies, for use in Server Components,
 * Route Handlers, and Server Actions. Reads run under the signed-in user's RLS.
 *
 * Callers must guard with isSupabaseConfigured() before using this in a context
 * where fixtures are the intended fallback.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll can be called from a Server Component render where cookies are
          // read-only. Middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
