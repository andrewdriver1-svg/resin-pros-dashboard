import { describe, expect, it } from 'vitest';
import {
  classifyEmail,
  extractLocation,
  extractScope,
  matchEntities,
  shouldCreateCandidate,
  type ClassifiableEmail,
  type MatchContext,
} from './classify';
import { planIngest, type ExistingThreadState } from './ingest';
import type { NormalizedMessage } from './gmail';

const ctx: MatchContext = {
  ownAddresses: ['andrew@resinprosflooringllc.com'],
  ownDomain: 'resinprosflooringllc.com',
  customers: [
    { id: 'c1', name: 'JR Sherman', email: 'jr@shermanbuilds.com' },
    { id: 'c2', name: 'Peter Abballe', email: 'peter@gmail.com' },
  ],
  leads: [{ id: 'l1', clientName: 'Lindsay Cox', contactEmail: 'l.cox@aol.com' }],
  quotes: [{ id: 'q1', number: 'Q-264', clientName: 'Peter Abballe' }],
  invoices: [{ id: 'i1', number: 'INV-3', clientName: 'JR Sherman' }],
  jobs: [{ id: 'j1', title: 'Warehouse floor', clientName: 'JR Sherman' }],
};

const email = (o: Partial<ClassifiableEmail>): ClassifiableEmail => ({
  fromAddress: 'someone@example.com',
  fromName: 'Someone',
  subject: '',
  bodyExtract: '',
  ...o,
});

describe('extraction', () => {
  it('pulls square footage and City, ST', () => {
    expect(extractScope('approximately 18,000 SF of resinous flooring')).toBe('18,000 SF');
    expect(extractScope('about 600 sq ft garage')).toBe('600 SF');
    expect(extractScope('no size here')).toBeUndefined();
    expect(extractLocation('project in King of Prussia, PA next month')).toBe('King of Prussia, PA');
    expect(extractLocation('nothing here')).toBeUndefined();
  });
});

describe('matchEntities', () => {
  it('matches a customer by exact sender address (highest confidence)', () => {
    const m = matchEntities(email({ fromAddress: 'jr@shermanbuilds.com' }), ctx)!;
    expect(m.customerId).toBe('c1');
    expect(m.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('adds a quote link when the customer mentions a known number', () => {
    const m = matchEntities(
      email({ fromAddress: 'peter@gmail.com', bodyExtract: 'Following up on Quote Q-264 from April' }),
      ctx,
    )!;
    expect(m.customerId).toBe('c2');
    expect(m.entityType).toBe('quote');
    expect(m.entityId).toBe('q1');
  });

  it('matches a tracked lead by address', () => {
    const m = matchEntities(email({ fromAddress: 'l.cox@aol.com' }), ctx)!;
    expect(m.entityType).toBe('lead');
    expect(m.entityId).toBe('l1');
  });

  it('matches a document number from an unknown address (uncertain, lower confidence)', () => {
    const m = matchEntities(email({ fromAddress: 'assistant@corp.com', subject: 'Re: INV-3 balance' }), ctx)!;
    expect(m.entityType).toBe('invoice');
    expect(m.confidence).toBeLessThan(0.9);
  });

  it('never treats a shared free-mail domain as a company match', () => {
    const m = matchEntities(email({ fromAddress: 'stranger@gmail.com' }), ctx);
    expect(m).toBeUndefined();
  });

  it('matches a company domain for business addresses', () => {
    const m = matchEntities(email({ fromAddress: 'office@shermanbuilds.com' }), ctx)!;
    expect(m.customerId).toBe('c1');
    expect(m.mechanism).toBe('company-domain');
  });
});

describe('classifyEmail', () => {
  it('flags a flooring estimate request as a new lead needing action', () => {
    const i = classifyEmail(
      email({
        fromAddress: 'gc@turnerconstruction.com',
        fromName: 'Turner Construction',
        subject: 'Warehouse flooring request',
        bodyExtract: 'Looking for pricing on approximately 18,000 SF of resinous flooring in King of Prussia, PA.',
      }),
      ctx,
    );
    expect(i.classification).toBe('new_lead');
    expect(i.actionRequired).toBe(true);
    expect(i.leadLikelihood).toBeGreaterThanOrEqual(0.5);
    expect(i.detectedScope).toBe('18,000 SF');
    expect(i.detectedLocation).toBe('King of Prussia, PA');
    expect(i.detectedCompany).toBe('Turnerconstruction');
    expect(shouldCreateCandidate(i)).toBe(true);
  });

  it('recognizes a bid invitation', () => {
    const i = classifyEmail(
      email({
        fromAddress: 'bids@whiting-turner.com',
        subject: 'Invitation to Bid — Flooring package, bids due 10/15',
        bodyExtract: 'You are invited to bid the resinous flooring scope package. Pre-bid walkthrough Tuesday.',
      }),
      ctx,
    );
    expect(i.classification).toBe('bid_invitation');
    expect(i.actionRequired).toBe(true);
    expect(shouldCreateCandidate(i)).toBe(true);
  });

  it('classifies a known customer reply about a quote — and does NOT create a candidate', () => {
    const i = classifyEmail(
      email({ fromAddress: 'peter@gmail.com', subject: 'Re: Q-264', bodyExtract: 'Can we talk about quote Q-264 pricing?' }),
      ctx,
    );
    expect(i.classification).toBe('existing_quote');
    expect(i.actionRequired).toBe(true);
    expect(shouldCreateCandidate(i)).toBe(false);
  });

  it('a reply from a tracked lead is actionable but not a NEW candidate', () => {
    const i = classifyEmail(
      email({ fromAddress: 'l.cox@aol.com', bodyExtract: 'Yes, still interested in the garage floor estimate.' }),
      ctx,
    );
    expect(i.classification).toBe('new_lead');
    expect(shouldCreateCandidate(i)).toBe(false);
  });

  it('sends newsletters and no-reply mail to the noise bucket', () => {
    const a = classifyEmail(
      email({ fromAddress: 'deals@supplier.com', subject: '20% off epoxy this week', bodyExtract: 'Sale ends Friday. Unsubscribe here. View in browser.', hasListUnsubscribe: true }),
      ctx,
    );
    expect(a.classification).toBe('newsletter_marketing');
    expect(a.actionRequired).toBe(false);
    const b = classifyEmail(email({ fromAddress: 'no-reply@random.io', subject: 'Your weekly digest' }), ctx);
    expect(b.classification).toBe('newsletter_marketing');
  });

  it('keeps platform notifications off the owner dashboard', () => {
    const i = classifyEmail(email({ fromAddress: 'notifications@getjobber.com', subject: 'New request received' }), ctx);
    expect(i.actionRequired).toBe(false);
    expect(['internal_admin', 'payment_accounting']).toContain(i.classification);
  });

  it('marks urgency from explicit language, never invents it', () => {
    const urgent = classifyEmail(
      email({ fromAddress: 'gc@acme-builders.com', subject: 'URGENT: need epoxy flooring bid today', bodyExtract: 'Need pricing for the flooring scope asap.' }),
      ctx,
    );
    expect(urgent.urgency).toBe('urgent');
    const calm = classifyEmail(
      email({ fromAddress: 'gc@acme-builders.com', subject: 'Flooring bid', bodyExtract: 'Please price the epoxy flooring scope.' }),
      ctx,
    );
    expect(calm.urgency).toBe('normal');
  });

  it('is deterministic and AI-independent: mechanism is rules:v1', () => {
    const i = classifyEmail(email({ fromAddress: 'x@y.com' }), ctx);
    expect(i.mechanism).toBe('rules:v1');
  });
});

// ── planIngest ───────────────────────────────────────────────────────────────

const msg = (o: Partial<NormalizedMessage>): NormalizedMessage => ({
  providerMessageId: 'm1',
  providerThreadId: 't1',
  fromAddress: 'gc@turnerconstruction.com',
  fromName: 'Turner Construction',
  toAddresses: ['andrew@resinprosflooringllc.com'],
  sentAt: '2026-09-30T13:42:00.000Z',
  subject: 'Warehouse flooring request',
  bodyExtract: 'Looking for pricing on approximately 18,000 SF of resinous flooring. Epoxy or urethane.',
  hasAttachments: false,
  attachmentMeta: [],
  hasListUnsubscribe: false,
  ...o,
});

describe('planIngest', () => {
  it('creates thread + message + intelligence + candidate for a new lead email', () => {
    const plan = planIngest([msg({})], new Set(), new Map(), ctx);
    expect(plan.messages).toHaveLength(1);
    expect(plan.threads).toHaveLength(1);
    expect(plan.threads[0].messageCount).toBe(1);
    expect(plan.threads[0].participants.map((p) => p.address)).toEqual(['gc@turnerconstruction.com']);
    expect(plan.intelligence[0].interpretation.classification).toBe('new_lead');
    expect(plan.candidates).toHaveLength(1);
    expect(plan.candidates[0].estimatedScope).toBe('18,000 SF');
    expect(plan.relevantCount).toBe(1);
  });

  it('is idempotent: already-ingested provider ids produce an empty plan', () => {
    const plan = planIngest([msg({})], new Set(['m1']), new Map(), ctx);
    expect(plan.messages).toHaveLength(0);
    expect(plan.threads).toHaveLength(0);
    expect(plan.candidates).toHaveLength(0);
  });

  it('extends an existing thread (count grows, first_message_at preserved) without a second candidate', () => {
    const existing = new Map<string, ExistingThreadState>([
      ['t1', { id: 'uuid-1', providerThreadId: 't1', status: 'open', messageCount: 2, participants: [{ address: 'gc@turnerconstruction.com', name: 'Turner Construction' }], firstMessageAt: '2026-09-29T10:00:00.000Z', subject: 'Warehouse flooring request', hasCandidate: true }],
    ]);
    const plan = planIngest([msg({ providerMessageId: 'm2', sentAt: '2026-09-30T15:00:00.000Z' })], new Set(), existing, ctx);
    expect(plan.threads[0].messageCount).toBe(3);
    expect(plan.threads[0].firstMessageAt).toBe('2026-09-29T10:00:00.000Z');
    expect(plan.candidates).toHaveLength(0); // dedupe on thread
  });

  it('never resurrects a candidate on a thread the owner dismissed', () => {
    const existing = new Map<string, ExistingThreadState>([
      ['t1', { id: 'uuid-1', providerThreadId: 't1', status: 'dismissed', messageCount: 1, participants: [], firstMessageAt: '2026-09-29T10:00:00.000Z', hasCandidate: false }],
    ]);
    const plan = planIngest([msg({ providerMessageId: 'm9' })], new Set(), existing, ctx);
    expect(plan.candidates).toHaveLength(0);
  });

  it('a manual link is the owner’s judgment — the matcher never overwrites it', () => {
    const existing = new Map<string, ExistingThreadState>([
      ['t1', { id: 'uuid-1', providerThreadId: 't1', status: 'open', linkMechanism: 'manual', messageCount: 1, participants: [], firstMessageAt: '2026-09-29T10:00:00.000Z', hasCandidate: true }],
    ]);
    const plan = planIngest(
      [msg({ providerMessageId: 'm3', fromAddress: 'jr@shermanbuilds.com' })],
      new Set(),
      existing,
      ctx,
    );
    expect(plan.threads[0].link).toBeUndefined();
  });

  it('classifies on the newest EXTERNAL message, not our own reply', () => {
    const plan = planIngest(
      [
        msg({ providerMessageId: 'm1', sentAt: '2026-09-30T10:00:00.000Z' }),
        msg({
          providerMessageId: 'm2',
          sentAt: '2026-09-30T11:00:00.000Z',
          fromAddress: 'andrew@resinprosflooringllc.com',
          fromName: 'Andrew',
          bodyExtract: 'Thanks, we will take a look.',
        }),
      ],
      new Set(),
      new Map(),
      ctx,
    );
    expect(plan.intelligence[0].interpretation.classification).toBe('new_lead');
    // Own address never appears as a participant.
    expect(plan.threads[0].participants.every((p) => p.address !== 'andrew@resinprosflooringllc.com')).toBe(true);
  });
});
