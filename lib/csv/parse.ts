/**
 * Robust bank/card statement CSV parsing.
 *
 * Replaces the naive split-on-comma parser. Handles:
 *  - Quoted fields containing commas, newlines, and escaped ("") quotes (RFC 4180).
 *  - CRLF or LF line endings, and a trailing blank line.
 *  - Common date formats, not just what Date.parse happens to accept.
 *  - Both amount sign conventions (negative-is-spend and positive-is-spend), plus
 *    separate Debit/Credit columns and accounting-style parentheses negatives.
 *
 * On an unrecognizable file (no header, no date column, no amount column) it
 * throws a specific Error. Malformed individual rows are collected as `errors`
 * rather than silently dropped, so the UI can show exactly what failed.
 */

import { businessConfig } from '@/config/business.config';

// ── low-level tokenizer (RFC 4180) ───────────────────────────────────────────
/** Split raw CSV text into rows of string cells. Quote-aware. */
export function tokenizeCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^﻿/, ''); // strip BOM

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      // Handle CRLF as a single break.
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // Flush trailing field/row (unless the input ended exactly on a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty rows (e.g. trailing blank line).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

// ── date parsing ─────────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += y >= 70 ? 1900 : 2000; // 2-digit year window
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Parse a date string in common statement formats, returning ISO `YYYY-MM-DD`
 * or null. Assumes US month-first ordering for ambiguous numeric dates (the
 * convention for US bank/card exports).
 */
export function parseDate(input: string): string | null {
  const t = input.trim();
  if (!t) return null;

  // ISO / YYYY-MM-DD (or with / or .)
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  // MM/DD/YYYY or M/D/YY (also with - or .)
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) return iso(Number(m[3]), Number(m[1]), Number(m[2]));

  // "Jul 5, 2026" / "5 Jul 2026" / "July 05 2026"
  m = t.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return iso(Number(m[3]), mon, Number(m[2]));
  }
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) return iso(Number(m[3]), mon, Number(m[1]));
  }
  return null;
}

// ── amount parsing ───────────────────────────────────────────────────────────
/**
 * Parse a currency string into a signed number. Handles `$`, thousands commas,
 * a leading/trailing minus, and accounting parentheses `(12.34)` = -12.34.
 * Returns null if there's no parseable number.
 */
export function parseAmount(input: string): number | null {
  let t = input.trim();
  if (!t) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(t)) {
    sign = -1;
    t = t.slice(1, -1);
  }
  if (t.includes('-')) sign *= -1;
  t = t.replace(/[$,\s]/g, '').replace(/-/g, '').replace(/[A-Za-z]/g, '');
  if (t === '' || t === '.') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return sign * n;
}

// ── header/column detection ──────────────────────────────────────────────────
function findColumn(headers: string[], patterns: RegExp[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim().toLowerCase();
    if (patterns.some((p) => p.test(h))) return i;
  }
  return -1;
}

export type SignConvention = 'auto' | 'negative_is_spend' | 'positive_is_spend';

export interface ParsedTransactionRow {
  date: string; // ISO
  description: string;
  /** Positive dollars spent. */
  amount: number;
  categoryId: string;
  kind: 'spend' | 'income';
}

export interface RowError {
  /** 1-based line number in the source file (accounting for the header). */
  line: number;
  reason: string;
  raw: string;
}

export interface ParseStatementResult {
  rows: ParsedTransactionRow[];
  errors: RowError[];
  /** Income/credit rows recognized but not imported as spend. */
  skippedIncome: number;
}

const CATEGORY_KEYWORDS: { id: string; re: RegExp }[] = [
  { id: 'materials', re: /resin|epoxy|sherwin|coating|aggregate|sealer|supply/i },
  { id: 'equipment-rental', re: /rental|sunbelt|united rent|home depot rent|grinder/i },
  { id: 'fuel-travel', re: /shell|fuel|gas|exxon|bp|mobil|chevron|toll|hotel|airfare/i },
  { id: 'disposal', re: /waste|dumpster|disposal|landfill/i },
  { id: 'software', re: /adobe|quickbooks|google|zoom|slack|subscription|saas/i },
  { id: 'insurance', re: /insurance|policy|premium/i },
  { id: 'permits', re: /permit|inspection|city of|county/i },
];

function guessCategory(description: string): string {
  return CATEGORY_KEYWORDS.find((c) => c.re.test(description))?.id ?? 'uncategorized';
}

/**
 * Parse a full statement CSV. Throws a specific Error if the file is structurally
 * unusable; otherwise returns parsed spend rows plus per-row errors.
 */
export function parseStatementCsv(
  text: string,
  opts: { signConvention?: SignConvention } = {},
): ParseStatementResult {
  const table = tokenizeCsv(text);
  if (table.length === 0) {
    throw new Error('The file is empty or contains no data rows.');
  }
  if (table.length === 1) {
    throw new Error('The file has a header but no transaction rows.');
  }

  const headers = table[0];
  const dateCol = findColumn(headers, [/date/, /posted/, /transaction date/]);
  const descCol = findColumn(headers, [/descr/, /memo/, /payee/, /name/, /detail/, /narrative/]);
  const amountCol = findColumn(headers, [/amount/, /value/]);
  const debitCol = findColumn(headers, [/debit/, /withdrawal/, /charge/, /money out/]);
  const creditCol = findColumn(headers, [/credit/, /deposit/, /payment received/, /money in/]);

  if (dateCol === -1) {
    throw new Error('Could not find a date column. Expected a header like "Date" or "Posted Date".');
  }
  if (amountCol === -1 && debitCol === -1 && creditCol === -1) {
    throw new Error('Could not find an amount column. Expected "Amount", or "Debit"/"Credit" columns.');
  }

  const dataRows = table.slice(1);

  // Resolve auto sign convention up front by sampling the single amount column.
  let convention = opts.signConvention ?? 'auto';
  if (convention === 'auto' && amountCol !== -1 && debitCol === -1) {
    const signs = dataRows
      .map((r) => parseAmount(r[amountCol] ?? ''))
      .filter((n): n is number => n != null);
    const hasNegative = signs.some((n) => n < 0);
    convention = hasNegative ? 'negative_is_spend' : 'positive_is_spend';
  }

  const rows: ParsedTransactionRow[] = [];
  const errors: RowError[] = [];
  let skippedIncome = 0;

  dataRows.forEach((cells, idx) => {
    const line = idx + 2; // +1 for header, +1 for 1-based
    const raw = cells.join(',');
    const dateIso = parseDate(cells[dateCol] ?? '');
    if (!dateIso) {
      errors.push({ line, reason: `Unparseable or missing date: "${(cells[dateCol] ?? '').trim()}"`, raw });
      return;
    }
    const description = (descCol !== -1 ? cells[descCol] : '')?.trim() || 'Transaction';

    // Determine signed amount + direction.
    let signed: number | null = null;
    if (debitCol !== -1 || creditCol !== -1) {
      const debit = debitCol !== -1 ? parseAmount(cells[debitCol] ?? '') : null;
      const credit = creditCol !== -1 ? parseAmount(cells[creditCol] ?? '') : null;
      if (debit != null && Math.abs(debit) > 0) signed = -Math.abs(debit); // spend
      else if (credit != null && Math.abs(credit) > 0) signed = Math.abs(credit); // income
      else signed = 0;
    } else {
      const parsed = parseAmount(cells[amountCol] ?? '');
      if (parsed == null) {
        errors.push({ line, reason: `Unparseable amount: "${(cells[amountCol] ?? '').trim()}"`, raw });
        return;
      }
      // Normalize so that negative always means spend.
      signed = convention === 'positive_is_spend' ? -parsed : parsed;
    }

    if (signed === 0) {
      errors.push({ line, reason: 'Row has no debit or credit amount.', raw });
      return;
    }

    if (signed < 0) {
      rows.push({
        date: dateIso,
        description,
        amount: Math.abs(signed),
        categoryId: guessCategory(description),
        kind: 'spend',
      });
    } else {
      skippedIncome++;
    }
  });

  return { rows, errors, skippedIncome };
}

/** Exposed for the UI: list of valid category ids for a dropdown. */
export const CATEGORY_IDS = businessConfig.spendingCategories.map((c) => c.id);
