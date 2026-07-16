'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export interface GoogleBusinessFormState {
  ok: boolean;
  message: string;
}

function toNumber(value: FormDataEntryValue | null): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Server action: save a new Google Business snapshot. Inserts a fresh row
 * (newest wins, keeping history). No-op with a clear message when Supabase isn't
 * configured, so the form degrades gracefully on fixtures.
 */
export async function updateGoogleBusinessSnapshot(
  _prev: GoogleBusinessFormState,
  formData: FormData,
): Promise<GoogleBusinessFormState> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      message: 'Supabase isn’t configured yet, so there’s nowhere to save this. The dashboard is showing sample data.',
    };
  }

  const rating = toNumber(formData.get('rating'));
  if (rating < 0 || rating > 5) {
    return { ok: false, message: 'Rating must be between 0 and 5.' };
  }

  const row = {
    rating,
    review_count: toNumber(formData.get('review_count')),
    phone: String(formData.get('phone') ?? ''),
    hours: String(formData.get('hours') ?? ''),
    profile_strength_ok: formData.get('profile_strength_ok') === 'on',
    facebook_followers: toNumber(formData.get('facebook_followers')),
    instagram_followers: toNumber(formData.get('instagram_followers')),
    updated_at: new Date().toISOString(),
  };

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from('google_business_snapshot').insert(row);
    if (error) return { ok: false, message: `Couldn’t save: ${error.message}` };
  } catch (err) {
    return { ok: false, message: `Couldn’t save: ${(err as Error).message}` };
  }

  revalidatePath('/settings');
  revalidatePath('/marketing');
  return { ok: true, message: 'Saved. The marketing numbers are updated.' };
}
