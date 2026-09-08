import { describe, expect, it } from 'vitest';
import { computeAttention, computeKpis, computePulse, invoiceBalance, isOverdue, PIPELINE_WEIGHT } from './insights';
import type { Invoice, Job, Lead, MaterialTodo, Quote, Transaction } from './db/types';

// Fixed "now": Tue Sep 8 2026, noon ET.
const NOW = new Date('2026-09-08T16:00:00Z');

const inv = (o: Partial<Invoice>): Invoice => ({
  id: 'i1',
  number: 'INV-1',
  clientName: 'Client',
  status: 'sent',
  amount: 1000,
  amountPaid: 0,
  ...o,
});
const quote = (o: Partial<Quote>): Quote => ({
  id: 'q1',
  number: 'Q-1',
  clientName: 'Client',
  status: 'awaiting_response',
  amount: 5000,
  ...o,
});
const job = (o: Partial<Job>): Job => ({
  id: 'j1',
  title: 'Job',
  clientName: 'Client',
  status: 'scheduled',
  value: 4000,
  ...o,
});
const lead = (o: Partial<Lead>): Lead => ({
  id: 'l1',
  clientName: 'Lead',
  summary: '',
  receivedAt: '2026-09-07T12:00:00Z',
  source: 'jobber_request',
  status: 'new',
  ...o,
});
const txn = (o: Partial<Transaction>): Transaction => ({
  id: 't1',
  date: '2026-09-05',
  description: 'spend',
  amount: 100,
  categoryId: 'materials',
  source: 'quickbooks',
  ...o,
});

const empty = { jobs: [], quotes: [], invoices: [], leads: [], transactions: [], todos: [] };

describe('invoiceBalance / isOverdue', () => {
  it('ignores drafts, bad debt, and unknown', () => {
    expect(invoiceBalance(inv({ status: 'draft' }))).toBe(0);
    expect(invoiceBalance(inv({ status: 'bad_debt' }))).toBe(0);
    expect(invoiceBalance(inv({ status: 'unknown' }))).toBe(0);
    expect(invoiceBalance(inv({ amount: 900, amountPaid: 250 }))).toBe(650);
  });

  it('flags past_due status and past dueAt, but never paid invoices', () => {
    expect(isOverdue(inv({ status: 'past_due' }), NOW.getTime())).toBe(true);
    expect(isOverdue(inv({ dueAt: '2026-08-01' }), NOW.getTime())).toBe(true);
    expect(isOverdue(inv({ dueAt: '2026-10-01' }), NOW.getTime())).toBe(false);
    expect(isOverdue(inv({ status: 'paid', amountPaid: 1000, dueAt: '2026-08-01' }), NOW.getTime())).toBe(false);
  });
});

describe('computeKpis', () => {
  it('splits invoiced totals into MTD, prior-month pace, and YTD', () => {
    const k = computeKpis(
      {
        ...empty,
        invoices: [
          inv({ id: 'a', issuedAt: '2026-09-02', amount: 3000, amountPaid: 1000 }),
          inv({ id: 'b', issuedAt: '2026-08-05', amount: 2000 }), // prev month, day ≤ 8 → pace
          inv({ id: 'c', issuedAt: '2026-08-20', amount: 7000 }), // prev month, after day 8 → not pace
          inv({ id: 'd', issuedAt: '2026-01-15', amount: 500 }), // YTD only
          inv({ id: 'e', issuedAt: '2026-09-03', amount: 100, status: 'draft' }), // ignored
        ],
      },
      NOW,
    );
    expect(k.invoicedMtd).toBe(3000);
    expect(k.collectedMtd).toBe(1000);
    expect(k.invoicedPrevPace).toBe(2000);
    expect(k.invoicedYtd).toBe(3000 + 2000 + 7000 + 500);
  });

  it('computes pipeline from awaiting_response quotes with the documented weight', () => {
    const k = computeKpis(
      {
        ...empty,
        quotes: [
          quote({ id: 'a', amount: 10_000 }),
          quote({ id: 'b', amount: 6000, status: 'approved' }), // not open
          quote({ id: 'c', amount: 4000 }),
        ],
      },
      NOW,
    );
    expect(k.pipelineValue).toBe(14_000);
    expect(k.pipelineCount).toBe(2);
    expect(k.weightedPipeline).toBe(14_000 * PIPELINE_WEIGHT);
  });

  it('sums AR and overdue AR', () => {
    const k = computeKpis(
      {
        ...empty,
        invoices: [
          inv({ id: 'a', amount: 5000, dueAt: '2026-08-15' }), // overdue 5000
          inv({ id: 'b', amount: 2000, dueAt: '2026-10-15' }), // outstanding, not due
          inv({ id: 'c', amount: 1000, amountPaid: 1000, status: 'paid' }),
        ],
      },
      NOW,
    );
    expect(k.arOutstanding).toBe(7000);
    expect(k.arOverdue).toBe(5000);
    expect(k.arOverdueCount).toBe(1);
  });
});

describe('computePulse', () => {
  it('returns all six signals with real-number details', () => {
    const signals = computePulse({ ...empty }, NOW);
    expect(signals.map((s) => s.key)).toEqual(['revenue', 'pipeline', 'collections', 'leads', 'schedule', 'expenses']);
  });

  it('flags stale pipeline and overdue collections', () => {
    const signals = computePulse(
      {
        ...empty,
        quotes: [quote({ issuedAt: '2026-08-20', amount: 12_000 })], // 19 days old, 100% of pipeline
        invoices: [inv({ amount: 8000, dueAt: '2026-08-01' })],
      },
      NOW,
    );
    const byKey = Object.fromEntries(signals.map((s) => [s.key, s]));
    expect(byKey.pipeline.health).toBe('attention');
    expect(byKey.collections.health).toBe('attention');
    expect(byKey.collections.detail).toContain('8,000');
  });

  it('watches a lead-volume drop', () => {
    const signals = computePulse(
      {
        ...empty,
        leads: [
          lead({ id: 'a', receivedAt: '2026-09-06T12:00:00Z' }), // this week: 1
          lead({ id: 'b', receivedAt: '2026-08-28T12:00:00Z' }), // prior week: 2
          lead({ id: 'c', receivedAt: '2026-08-29T12:00:00Z' }),
        ],
      },
      NOW,
    );
    const leads = signals.find((s) => s.key === 'leads')!;
    expect(leads.health).toBe('attention'); // 50% drop
    expect(leads.detail).toContain('50%');
  });
});

describe('computeAttention', () => {
  it('surfaces overdue invoices, stale quotes, cold leads, imminent jobs, late materials', () => {
    const items = computeAttention(
      {
        jobs: [job({ id: 'j', scheduledAt: '2026-09-09T12:00:00Z' })], // ~tomorrow
        quotes: [quote({ id: 'q', issuedAt: '2026-08-25', amount: 15_000 })], // 14 days
        invoices: [inv({ id: 'i', amount: 4000, dueAt: '2026-08-30' })],
        leads: [lead({ id: 'l', receivedAt: '2026-09-01T12:00:00Z' })], // 7 days cold
        todos: [
          { id: 't', kind: 'material', item: 'Epoxy base', status: 'needed', neededBy: '2026-09-05' } as MaterialTodo,
        ],
      },
      NOW,
    );
    const ids = items.map((i) => i.id);
    expect(ids).toContain('inv-i');
    expect(ids).toContain('quote-q');
    expect(ids).toContain('lead-l');
    expect(ids).toContain('job-j');
    expect(ids).toContain('todo-t');
    // High severity sorts first; the $15k stale quote outranks the $4k invoice by value.
    expect(items[0].severity).toBe('high');
    expect(items[0].id).toBe('quote-q');
  });

  it('is empty when the business is clean', () => {
    expect(computeAttention({ jobs: [], quotes: [], invoices: [], leads: [], todos: [] }, NOW)).toEqual([]);
  });

  it('does not nag about fresh leads or fresh quotes', () => {
    const items = computeAttention(
      {
        jobs: [],
        quotes: [quote({ issuedAt: '2026-09-06' })],
        invoices: [],
        leads: [lead({ receivedAt: '2026-09-07T12:00:00Z' })],
        todos: [],
      },
      NOW,
    );
    expect(items).toEqual([]);
  });
});
