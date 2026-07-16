import { describe, it, expect } from 'vitest';
import {
  mapJobStatus,
  mapQuoteStatus,
  mapInvoiceStatus,
  normalizeEnum,
  mapJobberJob,
  mapJobberInvoice,
  mapJobberRequest,
} from './sync';

describe('normalizeEnum', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalizeEnum('In_Progress')).toBe('inprogress');
    expect(normalizeEnum('Awaiting Response')).toBe('awaitingresponse');
    expect(normalizeEnum('PAST-DUE')).toBe('pastdue');
  });
  it('returns empty string for non-strings', () => {
    expect(normalizeEnum(null)).toBe('');
    expect(normalizeEnum(undefined)).toBe('');
    expect(normalizeEnum(42)).toBe('');
  });
});

describe('mapJobStatus', () => {
  it('maps known Jobber statuses to domain statuses', () => {
    expect(mapJobStatus('unscheduled')).toBe('lead');
    expect(mapJobStatus('active')).toBe('in_progress');
    expect(mapJobStatus('requires_invoicing')).toBe('complete');
    expect(mapJobStatus('archived')).toBe('archived');
  });
  it('is tolerant of casing and separators', () => {
    expect(mapJobStatus('In Progress')).toBe('in_progress');
    expect(mapJobStatus('COMPLETED')).toBe('complete');
  });
  it('falls back to unknown for unrecognized values', () => {
    expect(mapJobStatus('banana')).toBe('unknown');
    expect(mapJobStatus(null)).toBe('unknown');
    expect(mapJobStatus(undefined)).toBe('unknown');
  });
});

describe('mapQuoteStatus', () => {
  it('maps documented quote statuses', () => {
    expect(mapQuoteStatus('awaiting_response')).toBe('awaiting_response');
    expect(mapQuoteStatus('approved')).toBe('approved');
    expect(mapQuoteStatus('converted')).toBe('converted');
    expect(mapQuoteStatus('changes_requested')).toBe('awaiting_response');
  });
  it('falls back to unknown', () => {
    expect(mapQuoteStatus('')).toBe('unknown');
    expect(mapQuoteStatus('mystery')).toBe('unknown');
  });
});

describe('mapInvoiceStatus', () => {
  it('maps documented invoice statuses', () => {
    expect(mapInvoiceStatus('paid')).toBe('paid');
    expect(mapInvoiceStatus('past_due')).toBe('past_due');
    expect(mapInvoiceStatus('bad_debt')).toBe('bad_debt');
    expect(mapInvoiceStatus('awaiting_payment')).toBe('sent');
  });
  it('falls back to unknown', () => {
    expect(mapInvoiceStatus('whatever')).toBe('unknown');
  });
});

describe('defensive node mappers', () => {
  it('maps a well-formed job node', () => {
    const job = mapJobberJob({
      id: 'gid://1',
      jobNumber: 1001,
      title: 'Warehouse epoxy',
      jobStatus: 'active',
      total: 48500,
      startAt: '2026-07-14T12:00:00Z',
      client: { name: 'Kettle Ridge' },
      property: { address: { street: '4400 Industrial', city: 'Rochester', province: 'NY' } },
    });
    expect(job).not.toBeNull();
    expect(job!.status).toBe('in_progress');
    expect(job!.clientName).toBe('Kettle Ridge');
    expect(job!.value).toBe(48500);
    expect(job!.address).toContain('Rochester');
  });

  it('does not throw on missing fields — degrades each field', () => {
    const job = mapJobberJob({ id: 'gid://2' });
    expect(job).not.toBeNull();
    expect(job!.clientName).toBe('Unknown client');
    expect(job!.value).toBe(0);
    expect(job!.status).toBe('unknown');
    expect(job!.address).toBeUndefined();
  });

  it('returns null (not throw) when id is missing', () => {
    expect(mapJobberJob({ title: 'no id' })).toBeNull();
    expect(mapJobberInvoice({})).toBeNull();
    expect(mapJobberRequest({})).toBeNull();
  });

  it('extracts first email/phone from a request node', () => {
    const lead = mapJobberRequest({
      id: 'gid://r1',
      title: 'Epoxy request',
      requestStatus: 'converted',
      client: {
        name: 'Northline',
        emails: [{ address: 'a@x.com' }],
        phones: [{ number: '555-0143' }],
      },
    });
    expect(lead).not.toBeNull();
    expect(lead!.contactEmail).toBe('a@x.com');
    expect(lead!.contactPhone).toBe('555-0143');
    expect(lead!.status).toBe('won');
  });

  it('handles invoice amounts and balance fields', () => {
    const inv = mapJobberInvoice({
      id: 'gid://i1',
      invoiceNumber: 3015,
      invoiceStatus: 'partial',
      total: 24250,
      amountPaid: 12125,
      client: { name: 'Kettle Ridge' },
    });
    expect(inv!.amount).toBe(24250);
    expect(inv!.amountPaid).toBe(12125);
    expect(inv!.number).toBe('INV-3015');
    expect(inv!.status).toBe('partial');
  });
});
