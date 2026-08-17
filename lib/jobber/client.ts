/**
 * Jobber GraphQL client + OAuth2 flow.
 *
 * OAuth: authorization-code grant. Tokens are persisted in the Supabase
 * `jobber_oauth` table (single connection for the business). The client
 * transparently refreshes an expired access token before a request.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  DEFAULT_JOBBER_API_VERSION,
  JOBBER_AUTHORIZE_URL,
  JOBBER_GRAPHQL_URL,
  JOBBER_TOKEN_URL,
} from './queries';

const CLIENT_ID = process.env.JOBBER_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.JOBBER_CLIENT_SECRET ?? '';
const API_VERSION = process.env.JOBBER_API_VERSION || DEFAULT_JOBBER_API_VERSION;
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const REDIRECT_URI = `${APP_URL}/api/jobber/callback`;

/** Fixed single-row id — this app connects one Jobber account. */
const OAUTH_ROW_ID = 'primary';

export interface JobberTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

export function isJobberConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

/** Build the URL to send the owner to in order to grant access. */
export function getAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    state,
  });
  return `${JOBBER_AUTHORIZE_URL}?${params.toString()}`;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Every outbound call gets a hard timeout. A hung upstream otherwise pins a
 * serverless function until the platform kills it — and on the webhook path
 * Jobber then RETRIES, stacking more hung invocations behind the first.
 */
const FETCH_TIMEOUT_MS = 25_000;

async function requestToken(body: Record<string, string>): Promise<JobberTokens> {
  const res = await fetch(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as RawTokenResponse;
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new Error(
      `Jobber token request failed (${res.status}): ${json.error_description ?? json.error ?? 'unknown error'}`,
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // Refresh a minute early to avoid edge-of-expiry 401s.
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  };
}

export function exchangeCodeForTokens(code: string): Promise<JobberTokens> {
  return requestToken({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
}

export function refreshTokens(refreshToken: string): Promise<JobberTokens> {
  return requestToken({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

export async function saveJobberTokens(tokens: JobberTokens): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Cannot persist Jobber tokens: Supabase service role not configured.');
  const { error } = await admin.from('jobber_oauth').upsert({
    id: OAUTH_ROW_ID,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: new Date(tokens.expiresAt).toISOString(),
  });
  if (error) throw new Error(`Failed to save Jobber tokens: ${error.message}`);
}

export async function loadJobberTokens(): Promise<JobberTokens | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.from('jobber_oauth').select('*').eq('id', OAUTH_ROW_ID).maybeSingle();
  if (error || !data) return null;
  return {
    accessToken: String(data.access_token ?? ''),
    refreshToken: String(data.refresh_token ?? ''),
    expiresAt: data.expires_at ? new Date(data.expires_at).getTime() : 0,
  };
}

export interface GraphQLResult<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * Authenticated Jobber GraphQL client. Loads persisted tokens, refreshes when
 * expired, and issues POST requests with the required version header.
 */
export class JobberClient {
  private tokens: JobberTokens;

  private constructor(tokens: JobberTokens) {
    this.tokens = tokens;
  }

  /** Construct from persisted tokens, refreshing first if expired. Null if not connected. */
  static async fromStoredTokens(): Promise<JobberClient | null> {
    const tokens = await loadJobberTokens();
    if (!tokens || !tokens.accessToken) return null;
    const client = new JobberClient(tokens);
    await client.ensureFresh();
    return client;
  }

  /** For webhook/one-off use where tokens are already in hand. */
  static fromTokens(tokens: JobberTokens): JobberClient {
    return new JobberClient(tokens);
  }

  private async ensureFresh(): Promise<void> {
    if (Date.now() < this.tokens.expiresAt) return;
    this.tokens = await refreshTokens(this.tokens.refreshToken);
    await saveJobberTokens(this.tokens).catch((err) => {
      console.warn(`[jobber] token refreshed but not persisted: ${(err as Error).message}`);
    });
  }

  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    await this.ensureFresh();
    const res = await fetch(JOBBER_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        'Content-Type': 'application/json',
        'X-JOBBER-GRAPHQL-VERSION': API_VERSION,
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`Jobber GraphQL HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const json = (await res.json()) as GraphQLResult<T>;
    if (json.errors?.length) {
      throw new Error(`Jobber GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`);
    }
    if (!json.data) throw new Error('Jobber GraphQL returned no data.');
    return json.data;
  }
}
