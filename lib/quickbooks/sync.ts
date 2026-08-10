/**
 * QuickBooks → Supabase sync: pulls spending (Purchase transactions — checks,
 * card charges, cash expenses) into the `transactions` table.
 *
 * Same philosophy as lib/jobber/sync.ts: every field read is defensive — a
 * missing/renamed field degrades one column and logs a specific
 * "[quickbooks] … missing expected field" warning instead of throwing.
 *
 * Category mapping: QBO expense-account names are matched against the
 * dashboard's spending categories by keyword (see mapAccountNameToCategory).
 * Anything unmatched lands in 'uncategorized' for hand-triage on the
 * Spending page — synced rows are never silently miscategorized.
 */

import { businessConfig } from '@/config/business.config';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { QuickBooksClient, saveQuickBooksSyncTime } from './client';

// ── raw QBO shapes (fields we read; everything optional on purpose) ─────────
export interface QboRef {
  value?: string;
  name?: string;
}

export interface QboPurchaseLine {
  Amount?: number;
  Description?: string;
  DetailType?: string;
  AccountBasedExpenseLineDetail?: { AccountRef?: QboRef };
}

export interface QboPurchase {
  Id?: string;
  TxnDate?: string;
  TotalAmt?: number;
  /** true = refund/credit → treated as negative spend. */
  Credit?: boolean;
  PaymentType?: string;
  /** The bank / credit-card account the money left. */
  AccountRef?: QboRef;
  /** The payee (vendor). */
  EntityRef?: QboRef;
  PrivateNote?: string;
  Line?: QboPurchaseLine[];
  MetaData?: { LastUpdatedTime?: string };
}

/** Row shape upserted into the `transactions` table. */
export interface SyncedTransaction {
  qbo_id: string;
  date: string;
  description: string;
  amount: number;
  category_id: string;
  account_id: string | null;
  source: 'quickbooks';
}

function warnMissing(entity: string, id: string, field: string): void {
  console.warn(`[quickbooks] ${entity} ${id} missing expected field: ${field}`);
}

/**
 * Map a QBO expense-account name (e.g. "Job Materials", "Fuel", "Advertising")
 * to one of the dashboard's spending category ids. Pure + exported for tests.
 */
export function mapAccountNameToCategory(accountName: string | undefined): string {
  if (!accountName) return 'uncategorized';
  const n = accountName.toLowerCase();
  const rules: [RegExp, string][] = [
    [/material|supplie|resin|aggregate|sealer|epoxy|concrete/, 'materials'],
    [/rental|rent(al)? equip/, 'equipment-rental'],
    [/equipment|tool|machin/, 'equipment-purchase'],
    [/subcontract|contract labor|labor/, 'subcontractor'],
    [/fuel|gas|vehicle|auto|truck|travel|mileage/, 'fuel-travel'],
    [/disposal|dumpster|waste/, 'disposal'],
    [/permit|license|fee/, 'permits'],
    [/insurance/, 'insurance'],
    [/software|subscription|saas|dues/, 'software'],
    [/marketing|advertis|promo/, 'marketing'],
    [/office|admin|supplies office|postage|bank charge|utilities|phone|internet/, 'office-admin'],
  ];
  for (const [re, id] of rules) {
    if (re.test(n)) {
      // Only return ids that actually exist in config (guards config drift).
      if (businessConfig.spendingCategories.some((c) => c.id === id)) return id;
    }
  }
  return 'uncategorized';
}

/**
 * Map the QBO payment account (bank/cc the money left) to one of the
 * configured financial accounts, by loose name match. Pure + exported for tests.
 */
export function mapPaymentAccount(accountName: string | undefined): string | null {
  if (!accountName) return null;
  const n = accountName.toLowerCase();
  if (/credit|card|visa|master|amex/.test(n)) {
    return businessConfig.accounts.find((a) => a.type === 'credit_card')?.id ?? null;
  }
  if (/check|bank|operating|cash/.test(n)) {
    return businessConfig.accounts.find((a) => a.type === 'checking')?.id ?? null;
  }
  return null;
}

/** Convert one QBO Purchase into a transactions-table row. Pure + exported for tests. */
export function purchaseToTransaction(p: QboPurchase): SyncedTransaction | null {
  const id = p.Id;
  if (!id) {
    warnMissing('Purchase', '(unknown)', 'Id');
    return null;
  }
  if (p.TxnDate == null) warnMissing('Purchase', id, 'TxnDate');
  if (p.TotalAmt == null) warnMissing('Purchase', id, 'TotalAmt');

  const vendor = p.EntityRef?.name;
  const lineDesc = p.Line?.map((l) => l.Description).find((d) => typeof d === 'string' && d.length > 0);
  const description =
    [vendor, lineDesc ?? p.PrivateNote].filter(Boolean).join(' — ') || `QuickBooks purchase ${id}`;

  const expenseAccount = p.Line?.map((l) => l.AccountBasedExpenseLineDetail?.AccountRef?.name).find(Boolean);
  const total = typeof p.TotalAmt === 'number' && Number.isFinite(p.TotalAmt) ? p.TotalAmt : 0;

  return {
    qbo_id: id,
    date: typeof p.TxnDate === 'string' && p.TxnDate ? p.TxnDate : new Date().toISOString().slice(0, 10),
    description,
    // Spend is positive in the dashboard; a QBO credit (refund) goes negative.
    amount: p.Credit ? -total : total,
    category_id: mapAccountNameToCategory(expenseAccount),
    account_id: mapPaymentAccount(p.AccountRef?.name),
    source: 'quickbooks',
  };
}

export interface QuickBooksSyncResult {
  purchases: number;
  upserted: number;
  errors: string[];
}

/** How far back the FIRST sync reaches. Later syncs are incremental. */
const FIRST_SYNC_DAYS = 365;
const PAGE_SIZE = 200;

/**
 * Full idempotent sync: query Purchases updated since the last sync (or the
 * last FIRST_SYNC_DAYS on the first run) and upsert them by qbo_id.
 */
export async function syncQuickBooks(): Promise<QuickBooksSyncResult> {
  const result: QuickBooksSyncResult = { purchases: 0, upserted: 0, errors: [] };

  const client = await QuickBooksClient.fromStoredTokens();
  if (!client) {
    result.errors.push('QuickBooks is not connected.');
    return result;
  }
  const admin = createSupabaseAdminClient();
  if (!admin) {
    result.errors.push('Supabase service role not configured.');
    return result;
  }

  const since =
    client.lastSyncedAt ??
    new Date(Date.now() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const syncStartedAt = new Date().toISOString();

  try {
    let startPosition = 1;
    for (;;) {
      const page = await client.query<{ Purchase?: QboPurchase[] }>(
        `select * from Purchase where MetaData.LastUpdatedTime > '${since}' ` +
          `orderby MetaData.LastUpdatedTime startposition ${startPosition} maxresults ${PAGE_SIZE}`,
      );
      const purchases = Array.isArray(page.Purchase) ? page.Purchase : [];
      result.purchases += purchases.length;

      const rows = purchases.map(purchaseToTransaction).filter((r): r is SyncedTransaction => r !== null);
      if (rows.length > 0) {
        const { error } = await admin.from('transactions').upsert(rows, { onConflict: 'qbo_id' });
        if (error) {
          result.errors.push(`transactions upsert failed: ${error.message}`);
        } else {
          result.upserted += rows.length;
        }
      }

      if (purchases.length < PAGE_SIZE) break;
      startPosition += PAGE_SIZE;
    }
  } catch (err) {
    result.errors.push(`Purchase query failed: ${(err as Error).message}`);
  }

  if (result.errors.length === 0) {
    await saveQuickBooksSyncTime(syncStartedAt);
  }
  return result;
}
