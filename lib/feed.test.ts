import { describe, expect, it } from 'vitest';
import { buildFeed, groupFeedByDay, type FeedInputs } from './feed';
import type { Job, Quote } from './db/types';

const empty: FeedInputs = {
  quotes: [],
  invoices: [],
  jobs: [],
  leads: [],
  customers: [],
  candidates: [],
  activity: [],
};

const quote = (o: Partial<Quote>): Quote => ({
  id: 'q1',
  number: 'Q-295',
  clientName: 'Theresa Madiraca',
  status: 'awaiting_response',
  amount: 149_300,
  issuedAt: '2026-09-29T14:00:00.000Z',
  ...o,
});

const job = (o: Partial<Job>): Job => ({
  id: 'j1',
  title: 'Garage floor',
  clientName: 'Greg Moppert',
  status: 'in_progress',
  value: 5000,
  ...o,
});

describe('buildFeed', () => {
  it('emits events only for timestamps the source actually recorded', () => {
    const feed = buildFeed({
      ...empty,
      quotes: [quote({}), quote({ id: 'q2', number: 'Q-000', issuedAt: undefined })],
      jobs: [job({ scheduledAt: '2026-09-28T12:00:00.000Z' }), job({ id: 'j2' })], // j2: no dates → no events
    });
    expect(feed.map((e) => e.id)).toEqual(['quote:q1', 'job:j1:scheduled']);
  });

  it('is newest-first and capped', () => {
    const quotes = Array.from({ length: 50 }, (_, i) =>
      quote({ id: `q${i}`, issuedAt: new Date(Date.UTC(2026, 8, 1 + (i % 28), i % 24)).toISOString() }),
    );
    const feed = buildFeed({ ...empty, quotes }, 10);
    expect(feed).toHaveLength(10);
    for (let i = 1; i < feed.length; i++) {
      expect(new Date(feed[i - 1].at).getTime()).toBeGreaterThanOrEqual(new Date(feed[i].at).getTime());
    }
  });

  it('every event is clickable — href always present and specific when possible', () => {
    const feed = buildFeed({
      ...empty,
      quotes: [quote({ jobId: 'j9' })],
      jobs: [job({ completedAt: '2026-09-20T18:00:00.000Z' })],
      candidates: [
        {
          id: 'c1',
          source: 'email',
          company: 'Turner Construction',
          contactName: 'GC',
          summary: 'Warehouse flooring',
          estimatedScope: '18,000 SF',
          location: 'King of Prussia, PA',
          status: 'new',
          createdAt: '2026-09-30T10:00:00.000Z',
        },
      ],
    });
    expect(feed.every((e) => e.href.startsWith('/'))).toBe(true);
    expect(feed.find((e) => e.kind === 'quote')!.href).toBe('/jobs/j9'); // most specific link wins
    expect(feed.find((e) => e.kind === 'job_completed')!.href).toBe('/jobs/j1');
    const opp = feed.find((e) => e.kind === 'opportunity')!;
    expect(opp.href).toBe('/opportunities');
    expect(opp.detail).toBe('18,000 SF · King of Prussia, PA');
    expect(opp.source).toBe('email');
  });

  it('links Jobber records to the customer page when the client id is known', () => {
    const feed = buildFeed({
      ...empty,
      quotes: [quote({ jobberClientId: 'jc-1' })],
      customerIdByJobberClientId: new Map([['jc-1', 'cust-uuid']]),
    });
    expect(feed[0].href).toBe('/customers/cust-uuid');
  });

  it('carries internal log entries with entity-aware links', () => {
    const feed = buildFeed({
      ...empty,
      activity: [
        { id: 'a1', actor: 'human', verb: 'task.create', entityType: 'task', entityId: 't1', summary: 'Created task', createdAt: '2026-09-30T09:00:00.000Z' },
        { id: 'a2', actor: 'system', verb: 'sync', summary: 'Jobber sync', createdAt: '2026-09-30T08:00:00.000Z' },
      ],
    });
    expect(feed[0].href).toBe('/todo');
    expect(feed[1].source).toBe('internal');
  });

  it('never fabricates a paid/approved moment it does not have a date for', () => {
    // A paid invoice with only issuedAt yields exactly ONE event, at issue time,
    // with "paid" as context — not an invented payment event.
    const feed = buildFeed({
      ...empty,
      invoices: [
        { id: 'i1', number: 'INV-9', clientName: 'JR Sherman', status: 'paid', amount: 1000, amountPaid: 1000, issuedAt: '2026-09-15T12:00:00.000Z' },
      ],
    });
    expect(feed).toHaveLength(1);
    expect(feed[0].title).toBe('Invoice INV-9 issued');
    expect(feed[0].detail).toBe('paid');
    expect(feed[0].tone).toBe('good');
  });
});

describe('groupFeedByDay', () => {
  it('groups consecutive events by America/New_York business day', () => {
    const feed = buildFeed({
      ...empty,
      quotes: [
        quote({ id: 'q1', issuedAt: '2026-09-30T01:00:00.000Z' }), // Sep 29 9pm ET
        quote({ id: 'q2', issuedAt: '2026-09-29T14:00:00.000Z' }), // Sep 29 10am ET
        quote({ id: 'q3', issuedAt: '2026-09-28T14:00:00.000Z' }),
      ],
    });
    const groups = groupFeedByDay(feed, 'America/New_York');
    expect(groups).toHaveLength(2);
    expect(groups[0].events).toHaveLength(2); // the UTC-midnight straddler lands on Sep 29 ET
    expect(groups[0].day).toContain('Sep 29');
  });
});
