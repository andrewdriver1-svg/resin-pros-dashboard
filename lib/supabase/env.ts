/**
 * Central place to read Supabase env + decide whether Supabase is configured.
 * When it isn't, the whole app runs on fixtures and auth is bypassed in dev.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** True when the public client can talk to Supabase (auth + reads). */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** True when server-side privileged writes (webhooks, cron) are possible. */
export function isSupabaseAdminConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

/** In fixture/e2e mode we bypass the auth gate so routes render without Supabase. */
export function isFixtureMode(): boolean {
  return !isSupabaseConfigured() || process.env.E2E_FIXTURE_MODE === '1';
}
