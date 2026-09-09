/**
 * DATA TRUST — automated proof that production NEVER serves fixture data.
 *
 * Simulates "Supabase is configured but unreachable/failing" and asserts:
 *   - list reads return EMPTY, not fixtures
 *   - the failure is recorded in table health
 *   - the connectivity probe reports the outage
 * And in dev mode (unconfigured): fixtures are served as intended.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { configured: true, mode: 'throw' as 'throw' | 'error' | 'ok' };

vi.mock('@/lib/supabase/env', () => ({
  isSupabaseConfigured: () => state.configured,
  isSupabaseAdminConfigured: () => false,
  isFixtureMode: () => !state.configured,
  SUPABASE_URL: 'https://test.invalid',
  SUPABASE_ANON_KEY: 'test',
  SUPABASE_SERVICE_ROLE_KEY: '',
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    if (state.mode === 'throw') throw new Error('connect ECONNREFUSED (simulated outage)');
    return {
      from: () => {
        const builder: Record<string, unknown> = {};
        const chain = () => builder;
        builder.select = chain;
        builder.limit = chain;
        builder.order = chain;
        builder.then = (resolve: (v: unknown) => void) =>
          resolve(
            state.mode === 'error'
              ? { data: null, error: { message: 'permission denied (simulated)' } }
              : { data: [], error: null },
          );
        return builder;
      },
    };
  },
}));

describe('production data trust', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('a thrown connection error yields EMPTY data, never fixtures', async () => {
    state.configured = true;
    state.mode = 'throw';
    const db = await import('./index');
    const [tasks, jobs, quotes] = await Promise.all([db.getTasks(), db.getJobs(), db.getQuotes()]);
    expect(tasks).toEqual([]);
    expect(jobs).toEqual([]); // fixtures contain jobs — an empty array proves no fallback
    expect(quotes).toEqual([]);
  });

  it('a PostgREST error response also yields EMPTY data and records the failure', async () => {
    state.configured = true;
    state.mode = 'error';
    const db = await import('./index');
    const jobs = await db.getJobs();
    expect(jobs).toEqual([]);
    const health = db.getTableHealth().find((h) => h.table === 'jobs');
    expect(health?.ok).toBe(false);
    expect(health?.error).toContain('simulated');
  });

  it('the connectivity probe reports the outage', async () => {
    state.configured = true;
    state.mode = 'throw';
    const db = await import('./index');
    const probe = await db.probeDatabase();
    expect(probe.ok).toBe(false);
    expect(probe.error).toContain('simulated');
  });

  it('dev/demo mode (unconfigured) still serves fixtures by design', async () => {
    state.configured = false;
    const db = await import('./index');
    const jobs = await db.getJobs();
    expect(jobs.length).toBeGreaterThan(0); // fixtures ARE the intended dev source
  });
});
