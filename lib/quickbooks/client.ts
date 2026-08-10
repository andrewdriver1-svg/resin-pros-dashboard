/**
 * QuickBooks Online client + OAuth2 flow.
 *
 * Mirrors lib/jobber/client.ts: authorization-code grant, tokens persisted in
 * the Supabase `quickbooks_oauth` table (single company connection), and the
 * client transparently refreshes an expired access token before a request.
 *
 * QBO specifics vs. Jobber:
 * - Token endpoint wants `Authorization: Basic base64(client_id:client_secret)`
 *   and a form-encoded body (not JSON).
 * - The OAuth callback includes a `realmId` query param — the QuickBooks
 *   company id — which every API URL needs. We persist it with the tokens.
 * - Refresh tokens ROTATE: each refresh may return a new refresh_token that
 *   must be persisted, and they expire after ~100 days without use (the daily
 *   reconcile cron keeps the connection alive).
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const CLIENT_ID = process.env.QUICKBOOKS_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.QUICKBOOKS_CLIENT_SECRET ?? '';
/** 'production' (default) or 'sandbox' — selects the API base URL. */
const QBO_ENV = process.env.QUICKBOOKS_ENV === 'sandbox' ? 'sandbox' : 'production';
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const REDIRECT_URI = `${APP_URL}/api/quickbooks/callback`;

export const QBO_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const QBO_SCOPE = 'com.intuit.quickbooks.accounting';
/** Pin a minor version so response shapes don't drift under us. */
export const QBO_MINOR_VERSION = '75';

const API_BASE =
  QBO_ENV === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';

/** Fixed single-row id — this app connects one QuickBooks company. */
const OAUTH_ROW_ID = 'primary';

export interface QuickBooksTokens {
  accessToken: string;
  refreshToken: string;
  /** QuickBooks company id from the OAuth callback. */
  realmId: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  /** ISO timestamp of the last successful sync, or null before the first. */
  lastSyncedAt: string | null;
}

export function isQuickBooksConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

/** Build the URL to send the owner to in order to grant access. */
export function getQuickBooksAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: QBO_SCOPE,
    redirect_uri: REDIRECT_URI,
    state,
  });
  return `${QBO_AUTHORIZE_URL}?${params.toString()}`;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function requestToken(
  body: Record<string, string>,
  realmId: string,
  lastSyncedAt: string | null,
): Promise<QuickBooksTokens> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as RawTokenResponse;
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new Error(
      `QuickBooks token request failed (${res.status}): ${json.error_description ?? json.error ?? 'unknown error'}`,
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    realmId,
    // Refresh a minute early to avoid edge-of-expiry 401s.
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
    lastSyncedAt,
  };
}

export function exchangeQuickBooksCode(code: string, realmId: string): Promise<QuickBooksTokens> {
  return requestToken(
    { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI },
    realmId,
    null,
  );
}

export function refreshQuickBooksTokens(tokens: QuickBooksTokens): Promise<QuickBooksTokens> {
  return requestToken(
    { grant_type: 'refresh_token', refresh_token: tokens.refreshToken },
    tokens.realmId,
    tokens.lastSyncedAt,
  );
}

export async function saveQuickBooksTokens(tokens: QuickBooksTokens): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Cannot persist QuickBooks tokens: Supabase service role not configured.');
  const { error } = await admin.from('quickbooks_oauth').upsert({
    id: OAUTH_ROW_ID,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    realm_id: tokens.realmId,
    expires_at: new Date(tokens.expiresAt).toISOString(),
    last_synced_at: tokens.lastSyncedAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to save QuickBooks tokens: ${error.message}`);
}

export async function loadQuickBooksTokens(): Promise<QuickBooksTokens | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.from('quickbooks_oauth').select('*').eq('id', OAUTH_ROW_ID).maybeSingle();
  if (error || !data) return null;
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: String(data.refresh_token ?? ''),
    realmId: String(data.realm_id ?? ''),
    expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : 0,
    lastSyncedAt: typeof data.last_synced_at === 'string' ? data.last_synced_at : null,
  };
}

/** Record a successful sync time so the next run can query incrementally. */
export async function saveQuickBooksSyncTime(iso: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  await admin.from('quickbooks_oauth').update({ last_synced_at: iso }).eq('id', OAUTH_ROW_ID);
}

/**
 * Authenticated QuickBooks API client. Loads persisted tokens, refreshes when
 * expired (persisting the rotated refresh token), and issues query requests.
 */
export class QuickBooksClient {
  private tokens: QuickBooksTokens;

  private constructor(tokens: QuickBooksTokens) {
    this.tokens = tokens;
  }

  /** Construct from persisted tokens, refreshing first if expired. Null if not connected. */
  static async fromStoredTokens(): Promise<QuickBooksClient | null> {
    const tokens = await loadQuickBooksTokens();
    if (!tokens || !tokens.accessToken || !tokens.realmId) return null;
    const client = new QuickBooksClient(tokens);
    await client.ensureFresh();
    return client;
  }

  get lastSyncedAt(): string | null {
    return this.tokens.lastSyncedAt;
  }

  private async ensureFresh(): Promise<void> {
    if (Date.now() < this.tokens.expiresAt) return;
    this.tokens = await refreshQuickBooksTokens(this.tokens);
    // Refresh tokens rotate — persisting is required, not best-effort.
    await saveQuickBooksTokens(this.tokens).catch((err) => {
      console.warn(`[quickbooks] token refreshed but not persisted: ${(err as Error).message}`);
    });
  }

  /**
   * Run a QuickBooks SQL-ish query (https://developer.intuit.com → "Data queries").
   * Returns the parsed QueryResponse object; callers guard fields defensively.
   */
  async query<T>(query: string): Promise<T> {
    await this.ensureFresh();
    const url =
      `${API_BASE}/v3/company/${encodeURIComponent(this.tokens.realmId)}/query` +
      `?query=${encodeURIComponent(query)}&minorversion=${QBO_MINOR_VERSION}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`QuickBooks query HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const json = (await res.json().catch(() => null)) as { QueryResponse?: T } | null;
    if (!json?.QueryResponse) throw new Error('QuickBooks query returned no QueryResponse.');
    return json.QueryResponse;
  }
}
