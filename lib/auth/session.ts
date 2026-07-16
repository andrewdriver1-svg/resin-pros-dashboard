/**
 * Server-side auth/session helpers used by the dashboard layout.
 *
 * In fixture mode there's no real auth, so we return a synthetic "linked" state
 * and the dashboard renders on fixtures. In configured mode we read the real
 * Supabase user and check for a business_members row.
 */

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isFixtureMode } from '@/lib/supabase/env';

export interface SessionState {
  /** True when a user is signed in (always true in fixture mode). */
  signedIn: boolean;
  /** Email of the signed-in user, if known. */
  email: string | null;
  /** True when the user has a business_members row (always true in fixture mode). */
  linked: boolean;
  /** Business name, when linked. */
  businessName: string | null;
  /** True when running on fixtures (no Supabase). */
  fixtureMode: boolean;
}

export async function getSessionState(): Promise<SessionState> {
  if (isFixtureMode()) {
    return { signedIn: true, email: null, linked: true, businessName: null, fixtureMode: true };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { signedIn: false, email: null, linked: false, businessName: null, fixtureMode: false };
  }

  // Is this user linked to a business?
  const { data: membership } = await supabase
    .from('business_members')
    .select('business_id, businesses(name)')
    .eq('user_id', user.id)
    .maybeSingle();

  const businessName =
    membership && typeof membership === 'object' && 'businesses' in membership
      ? ((membership.businesses as { name?: string } | null)?.name ?? null)
      : null;

  return {
    signedIn: true,
    email: user.email ?? null,
    linked: Boolean(membership),
    businessName,
    fixtureMode: false,
  };
}
