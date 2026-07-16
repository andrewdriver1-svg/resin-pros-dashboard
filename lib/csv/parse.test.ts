import { describe, it, expect } from 'vitest';
import { tokenizeCsv, parseDate, parseAmount, parseStatementCsv } from './parse';

describe('tokenizeCsv', () => {
  it('handles quoted fields containing commas', () => {
    const rows = tokenizeCsv('Date,Description,Amount\n2026-07-01,"SUPPLY CO, INC",100.00');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['2026-07-01', 'SUPPLY CO, INC', '100.00']);
  });

  it('handles escaped double-quotes inside quoted fields', () => {
    const rows = tokenizeCsv('a,b\n"say ""hi""",2');
    expect(rows[1][0]).toBe('say "hi"');
  });

  it('handles CRLF line endings and a trailing blank line', () => {
    const rows = tokenizeCsv('a,b\r\n1,2\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['1', '2']);
  });

  it('handles newlines inside quoted fields', () => {
    const rows = tokenizeCsv('a,b\n"line1\nline2",x');
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('line1\nline2');
  });

  it('strips a BOM', () => {
    const rows = tokenizeCsv('﻿a,b\n1,2');
    expect(rows[0]).toEqual(['a', 'b']);
  });
});

describe('parseDate', () => {
  it('parses ISO', () => {
    expect(parseDate('2026-07-05')).toBe('2026-07-05');
  });
  it('parses US MM/DD/YYYY', () => {
    expect(parseDate('07/05/2026')).toBe('2026-07-05');
    expect(parseDate('7/5/2026')).toBe('2026-07-05');
  });
  it('parses 2-digit years into the 2000s', () => {
    expect(parseDate('07/05/26')).toBe('2026-07-05');
  });
  it('parses "Mon DD, YYYY"', () => {
    expect(parseDate('Jul 5, 2026')).toBe('2026-07-05');
    expect(parseDate('July 05 2026')).toBe('2026-07-05');
  });
  it('parses "DD Mon YYYY"', () => {
    expect(parseDate('5 Jul 2026')).toBe('2026-07-05');
  });
  it('returns null for garbage', () => {
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('parseAmount', () => {
  it('parses plain and currency-formatted numbers', () => {
    expect(parseAmount('100.00')).toBe(100);
    expect(parseAmount('$1,234.56')).toBe(1234.56);
  });
  it('parses negatives and accounting parentheses', () => {
    expect(parseAmount('-50')).toBe(-50);
    expect(parseAmount('(50.00)')).toBe(-50);
    expect(parseAmount('($1,000.00)')).toBe(-1000);
  });
  it('returns null when there is no number', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('N/A')).toBeNull();
  });
});

describe('parseStatementCsv', () => {
  it('throws a specific error when there is no date column', () => {
    expect(() => parseStatementCsv('Foo,Bar\n1,2')).toThrow(/date column/i);
  });

  it('throws a specific error when there is no amount column', () => {
    expect(() => parseStatementCsv('Date,Memo\n2026-07-01,hello')).toThrow(/amount column/i);
  });

  it('throws when the file has a header but no rows', () => {
    expect(() => parseStatementCsv('Date,Amount')).toThrow(/no transaction rows/i);
  });

  it('auto-detects negative-is-spend and imports only spend rows', () => {
    const csv = ['Date,Description,Amount', '07/01/2026,SUPPLY CO,-100.00', '07/02/2026,CUSTOMER DEPOSIT,500.00'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amount).toBe(100);
    expect(result.rows[0].date).toBe('2026-07-01');
    expect(result.skippedIncome).toBe(1);
  });

  it('treats all-positive amount columns as positive-is-spend', () => {
    const csv = ['Date,Description,Amount', '07/01/2026,SHELL FUEL,42.60', '07/03/2026,SHERWIN RESIN,300.00'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.amount > 0)).toBe(true);
  });

  it('honors an explicit positive_is_spend override', () => {
    const csv = ['Date,Description,Amount', '07/01/2026,THING,100.00', '07/02/2026,REFUND,-20.00'].join('\n');
    const result = parseStatementCsv(csv, { signConvention: 'positive_is_spend' });
    // positive = spend → the 100 row is spend, the -20 is treated as income
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amount).toBe(100);
    expect(result.skippedIncome).toBe(1);
  });

  it('supports separate Debit/Credit columns', () => {
    const csv = ['Date,Description,Debit,Credit', '07/01/2026,SUPPLY,100.00,', '07/02/2026,DEPOSIT,,500.00'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amount).toBe(100);
    expect(result.skippedIncome).toBe(1);
  });

  it('reports unparseable rows instead of dropping them silently', () => {
    const csv = ['Date,Description,Amount', 'not-a-date,X,-10', '07/02/2026,Y,notanumber', '07/03/2026,Z,-30'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows).toHaveLength(1); // only the valid -30 row
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].line).toBe(2);
    expect(result.errors[1].line).toBe(3);
  });

  it('guesses categories from description keywords', () => {
    const csv = ['Date,Description,Amount', '07/01/2026,SHERWIN RESIN SUPPLY,-100', '07/02/2026,SHELL FUEL,-40'].join('\n');
    const result = parseStatementCsv(csv);
    const byDesc = Object.fromEntries(result.rows.map((r) => [r.description, r.categoryId]));
    expect(byDesc['SHERWIN RESIN SUPPLY']).toBe('materials');
    expect(byDesc['SHELL FUEL']).toBe('fuel-travel');
  });

  it('handles quoted descriptions with commas end-to-end', () => {
    const csv = ['Date,Description,Amount', '07/01/2026,"SUPPLY CO, INC",-100.00'].join('\n');
    const result = parseStatementCsv(csv);
    expect(result.rows[0].description).toBe('SUPPLY CO, INC');
  });
});
