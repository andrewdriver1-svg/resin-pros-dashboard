/**
 * Gmail provider — official Gmail REST API over OAuth2, READ-ONLY.
 *
 * Scope is exactly `gmail.readonly` (least privilege): the OS reads, it never
 * sends, deletes, archives, labels, or marks anything. Tokens persist in the
 * `email_accounts` table (service-role only, no member policies — the same
 * pattern as jobber_oauth) and never reach the browser.
 *
 * Connection requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in the server
 * environment (a Google Cloud OAuth client with the Gmail API enabled). When
 * they are absent the integration reports "not configured" and everything
 * else in the app is unaffected.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';
const REDIRECT_URI = `${APP_URL}/api/email/callback`;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** READ-ONLY. Widening this scope is a product decision, not a code tweak. */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const FETCH_TIMEOUT_MS = 25_000;
const ROW_ID = 'primary';

export function isEmailConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function getEmailAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface EmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function requestToken(body: Record<string, string>): Promise<RawTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return (await res.json().catch(() => ({}))) as RawTokenResponse;
}

export async function exchangeEmailCode(code: string): Promise<EmailTokens> {
  const json = await requestToken({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
  if (!json.access_token || !json.refresh_token) {
    throw new Error(`Google token exchange failed: ${json.error_description ?? json.error ?? 'no tokens returned'}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  };
}

async function refreshEmailTokens(refreshToken: string): Promise<EmailTokens> {
  const json = await requestToken({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (!json.access_token) {
    throw new Error(`Google token refresh failed: ${json.error_description ?? json.error ?? 'no access token'}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken, // Google does not rotate refresh tokens on refresh
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  };
}

// ── account persistence (service role only) ──────────────────────────────────

export interface EmailAccountRow {
  address: string;
  tokens: EmailTokens;
  watermarkAt: string | null;
  status: string;
  lastError: string | null;
}

export async function saveEmailAccount(address: string, tokens: EmailTokens): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error('Cannot persist email tokens: service role not configured.');
  const { error } = await admin.from('email_accounts').upsert({
    id: ROW_ID,
    provider: 'gmail',
    address,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: new Date(tokens.expiresAt).toISOString(),
    status: 'connected',
    last_error: null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Failed to save email account: ${error.message}`);
}

export async function loadEmailAccount(): Promise<EmailAccountRow | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data } = await admin.from('email_accounts').select('*').eq('id', ROW_ID).maybeSingle();
  if (!data || !data.refresh_token) return null;
  return {
    address: String(data.address ?? ''),
    tokens: {
      accessToken: String(data.access_token ?? ''),
      refreshToken: String(data.refresh_token ?? ''),
      expiresAt: data.expires_at ? new Date(data.expires_at as string).getTime() : 0,
    },
    watermarkAt: (data.watermark_at as string | null) ?? null,
    status: String(data.status ?? 'connected'),
    lastError: (data.last_error as string | null) ?? null,
  };
}

export async function updateEmailAccountState(patch: {
  watermarkAt?: string;
  status?: 'connected' | 'error';
  lastError?: string | null;
  tokens?: EmailTokens;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.watermarkAt) row.watermark_at = patch.watermarkAt;
  if (patch.status) row.status = patch.status;
  if (patch.lastError !== undefined) row.last_error = patch.lastError;
  if (patch.tokens) {
    row.access_token = patch.tokens.accessToken;
    row.expires_at = new Date(patch.tokens.expiresAt).toISOString();
  }
  await admin.from('email_accounts').update(row).eq('id', ROW_ID);
}

// ── authenticated client ─────────────────────────────────────────────────────

export class GmailClient {
  private constructor(private tokens: EmailTokens) {}

  static async fromStoredTokens(): Promise<GmailClient | null> {
    const account = await loadEmailAccount();
    if (!account) return null;
    const client = new GmailClient(account.tokens);
    await client.ensureFresh();
    return client;
  }

  private async ensureFresh(): Promise<void> {
    if (Date.now() < this.tokens.expiresAt) return;
    this.tokens = await refreshEmailTokens(this.tokens.refreshToken);
    await updateEmailAccountState({ tokens: this.tokens }).catch(() => {});
  }

  private async get<T>(path: string): Promise<T> {
    await this.ensureFresh();
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Gmail API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  async profile(): Promise<{ emailAddress: string }> {
    return this.get('/profile');
  }

  /** List message ids matching a Gmail query (newest first). */
  async listMessageIds(query: string, max = 100): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    while (ids.length < max) {
      const qs = new URLSearchParams({ q: query, maxResults: String(Math.min(100, max - ids.length)) });
      if (pageToken) qs.set('pageToken', pageToken);
      const data = await this.get<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${qs}`);
      for (const m of data.messages ?? []) ids.push(m.id);
      if (!data.nextPageToken || !data.messages?.length) break;
      pageToken = data.nextPageToken;
    }
    return ids;
  }

  async getMessage(id: string): Promise<GmailMessage> {
    return this.get<GmailMessage>(`/messages/${id}?format=full`);
  }
}

// ── Gmail payload shapes + normalization ─────────────────────────────────────

export interface GmailMessagePart {
  mimeType?: string;
  filename?: string;
  body?: { size?: number; data?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GmailMessagePart & { headers?: { name: string; value: string }[] };
}

export interface NormalizedMessage {
  providerMessageId: string;
  providerThreadId: string;
  fromAddress: string;
  fromName: string;
  toAddresses: string[];
  sentAt: string;
  subject: string;
  bodyExtract: string;
  hasAttachments: boolean;
  attachmentMeta: { filename: string; mimeType: string; size: number }[];
  hasListUnsubscribe: boolean;
}

const BODY_EXTRACT_MAX = 4000;

export function header(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export function parseAddress(raw: string): { address: string; name: string } {
  const m = raw.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (m) return { name: (m[1] ?? '').trim(), address: m[2].trim().toLowerCase() };
  return { name: '', address: raw.trim().toLowerCase() };
}

function decodeB64Url(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/** Strip HTML to readable text (good enough for classification + preview). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function walkParts(part: GmailMessagePart | undefined, out: { text: string[]; html: string[]; attachments: NormalizedMessage['attachmentMeta'] }): void {
  if (!part) return;
  if (part.filename) {
    out.attachments.push({ filename: part.filename, mimeType: part.mimeType ?? '', size: part.body?.size ?? 0 });
  } else if (part.mimeType === 'text/plain' && part.body?.data) {
    out.text.push(decodeB64Url(part.body.data));
  } else if (part.mimeType === 'text/html' && part.body?.data) {
    out.html.push(decodeB64Url(part.body.data));
  }
  for (const p of part.parts ?? []) walkParts(p, out);
}

export function normalizeGmailMessage(msg: GmailMessage): NormalizedMessage {
  const from = parseAddress(header(msg, 'From'));
  const to = header(msg, 'To')
    .split(',')
    .map((r) => parseAddress(r).address)
    .filter(Boolean);
  const collected = { text: [] as string[], html: [] as string[], attachments: [] as NormalizedMessage['attachmentMeta'] };
  walkParts(msg.payload, collected);
  const body = (collected.text.join('\n') || htmlToText(collected.html.join('\n'))).slice(0, BODY_EXTRACT_MAX);
  return {
    providerMessageId: msg.id,
    providerThreadId: msg.threadId,
    fromAddress: from.address,
    fromName: from.name,
    toAddresses: to,
    sentAt: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : new Date().toISOString(),
    subject: header(msg, 'Subject'),
    bodyExtract: body,
    hasAttachments: collected.attachments.length > 0,
    attachmentMeta: collected.attachments.slice(0, 20),
    hasListUnsubscribe: Boolean(header(msg, 'List-Unsubscribe')),
  };
}
