import { createClient } from '@supabase/supabase-js';
import { SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, isSupabaseAdminConfigured } from './env';

/**
 * Service-role client for trusted server contexts only (webhook receiver, cron
 * reconciliation). Bypasses RLS — never import this into a browser bundle or a
 * user-facing route.
 *
 * Returns null when the service role key isn't configured, so callers degrade
 * gracefully instead of crashing.
 */
export function createSupabaseAdminClient() {
  if (!isSupabaseAdminConfigured()) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
