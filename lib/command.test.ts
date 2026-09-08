import { describe, expect, it } from 'vitest';
import {
  assertReadOnly,
  buildRecordCommands,
  fuzzyScore,
  parseMoneyQuery,
  searchCommands,
  STATIC_COMMANDS,
  type Command,
} from './command';
import type { Invoice, Job, Lead, Quote, Transaction } from './db/types';

const data = {
  leads: [
    {
      id: 'l1',
      clientName: 'Bright Dental',
      summary: 'Waiting room epoxy floor',
      receivedAt: '2026-09-01T12:00:00Z',
      source: 'jobber_request',
      status: 'new',
    } as Lead,
  ],
  jobs: [
    {
      id: 'j1',
      title: 'Warehouse epoxy floor — 12,000 sqft',
      clientName: 'Kettle Ridge Distribution',
      status: 'in_progress',
      value: 48_500,
      scheduledAt: '2026-07-14T12:00:00Z',
    } as Job,
  ],
  quotes: [
    {
      id: 'q1',
      number: 'Q-264',
      clientName: 'Peter Abballe',
      status: 'awaiting_response',
      amount: 286_465,
      issuedAt: '2026-04-16',
    } as Quote,
  ],
  invoices: [
    {
      id: 'i1',
      number: 'INV-3012',
      clientName: 'Lakeside Catering Co.',
      status: 'past_due',
      amount: 16_200,
      amountPaid: 0,
      dueAt: '2026-07-18',
    } as Invoice,
  ],
  transactions: [
    {
      id: 't1',
      date: '2026-09-05',
      description: 'Sherwin-Williams — epoxy base coat',
      amount: 1_240,
      categoryId: 'materials',
      source: 'quickbooks',
    } as Transaction,
  ],
};

describe('registry invariants', () => {
  it('has unique ids and is fully read-only in Phase B', () => {
    const all = [...STATIC_COMMANDS, ...buildRecordCommands(data)];
    const ids = new Set(all.map((c) => c.id));
    expect(ids.size).toBe(all.length);
    expect(() => assertReadOnly(all)).not.toThrow();
  });

  it('assertReadOnly rejects a mutating command', () => {
    const bad: Command = { ...STATIC_COMMANDS[0], id: 'action:x', mutates: true };
    expect(() => assertReadOnly([bad])).toThrow(/action:x/);
  });

  it('every record command links somewhere real', () => {
    for (const c of buildRecordCommands(data)) {
      expect(c.href.startsWith('/')).toBe(true);
    }
    const job = buildRecordCommands(data).find((c) => c.id === 'job:j1')!;
    expect(job.href).toBe('/jobs/j1');
  });
});

describe('fuzzyScore', () => {
  it('ranks substring above word-prefix above subsequence', () => {
    const sub = fuzzyScore('epoxy', 'Warehouse epoxy floor');
    const prefix = fuzzyScore('ware fl', 'Warehouse epoxy floor');
    const subseq = fuzzyScore('whef', 'Warehouse epoxy floor');
    expect(sub).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(subseq);
    expect(subseq).toBeGreaterThan(0);
  });

  it('matches record numbers with or without punctuation', () => {
    expect(fuzzyScore('q264', 'Quote Q-264')).toBeGreaterThan(50);
    expect(fuzzyScore('inv 3012', 'Invoice INV-3012')).toBeGreaterThan(50);
    expect(fuzzyScore('3012', 'Invoice INV-3012')).toBeGreaterThan(50);
  });

  it('rejects nonsense', () => {
    expect(fuzzyScore('zzqx', 'Warehouse epoxy floor')).toBe(-1);
  });
});

describe('parseMoneyQuery', () => {
  it('parses $, commas, and k-suffix', () => {
    expect(parseMoneyQuery('$18,400').money).toEqual({ op: 'near', value: 18_400 });
    expect(parseMoneyQuery('25k').money).toEqual({ op: 'near', value: 25_000 });
    expect(parseMoneyQuery('>10k quotes').money).toEqual({ op: 'at-least', value: 10_000 });
    expect(parseMoneyQuery('over 10000').money).toEqual({ op: 'at-least', value: 10_000 });
  });

  it('leaves small bare numbers alone (they are usually part of a name)', () => {
    expect(parseMoneyQuery('264').money).toBeNull();
    expect(parseMoneyQuery('600 sqft flake').money).toBeNull();
  });

  it('returns the non-money remainder for fuzzy matching', () => {
    expect(parseMoneyQuery('>10k quotes').rest).toBe('quotes');
  });
});

describe('searchCommands', () => {
  const all = [...STATIC_COMMANDS, ...buildRecordCommands(data)];

  it('finds navigation by keyword', () => {
    const groups = searchCommands('estimates', all);
    const navGroup = groups.find((g) => g.category === 'Navigation');
    expect(navGroup?.items.some((i) => i.command.id === 'nav:quotes')).toBe(true);
  });

  it('finds a record by client name and groups by entity', () => {
    const groups = searchCommands('kettle', all);
    const jobs = groups.find((g) => g.category === 'Jobs');
    expect(jobs?.items[0].command.id).toBe('job:j1');
  });

  it('finds by document number', () => {
    const groups = searchCommands('inv-3012', all);
    const invoices = groups.find((g) => g.category === 'Invoices');
    expect(invoices?.items[0].command.id).toBe('invoice:i1');
  });

  it('filters by minimum dollar value', () => {
    const groups = searchCommands('>100k', all);
    const flat = groups.flatMap((g) => g.items.map((i) => i.command.id));
    expect(flat).toContain('quote:q1');
    expect(flat).not.toContain('invoice:i1'); // 16,200 < 100k
  });

  it('matches an exact dollar amount', () => {
    const groups = searchCommands('$16,200', all);
    const flat = groups.flatMap((g) => g.items.map((i) => i.command.id));
    expect(flat).toContain('invoice:i1');
    expect(flat).not.toContain('quote:q1');
  });

  it('combines money and text', () => {
    const groups = searchCommands('>10k peter', all);
    const flat = groups.flatMap((g) => g.items.map((i) => i.command.id));
    expect(flat).toContain('quote:q1');
    expect(flat).not.toContain('job:j1'); // 48.5k but not Peter's
  });

  it('returns nothing for an empty query', () => {
    expect(searchCommands('', all)).toEqual([]);
  });

  it('keeps groups in stable category order', () => {
    const groups = searchCommands('e', all); // broad
    const order = groups.map((g) => g.category);
    const canonical = ['Navigation', 'Views', 'Leads', 'Jobs', 'Quotes', 'Invoices', 'Transactions'];
    expect([...order].sort((a, b) => canonical.indexOf(a) - canonical.indexOf(b))).toEqual(order);
  });
});
