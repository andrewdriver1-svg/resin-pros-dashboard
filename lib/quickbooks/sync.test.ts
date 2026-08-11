import { describe, expect, it } from 'vitest';
import {
  mapAccountNameToCategory,
  mapPaymentAccount,
  purchaseToTransaction,
  type QboPurchase,
} from './sync';

describe('mapAccountNameToCategory', () => {
  it('maps material-ish account names to materials', () => {
    expect(mapAccountNameToCategory('Job Materials')).toBe('materials');
    expect(mapAccountNameToCategory('Supplies & Materials')).toBe('materials');
    expect(mapAccountNameToCategory('Epoxy Resin')).toBe('materials');
  });

  it('maps common overhead accounts', () => {
    expect(mapAccountNameToCategory('Advertising & Marketing')).toBe('marketing');
    expect(mapAccountNameToCategory('Insurance Expense')).toBe('insurance');
    expect(mapAccountNameToCategory('Software Subscriptions')).toBe('software');
    expect(mapAccountNameToCategory('Fuel')).toBe('fuel-travel');
  });

  it('falls back to uncategorized for unknown or missing names', () => {
    expect(mapAccountNameToCategory('Miscellaneous Weirdness')).toBe('uncategorized');
    expect(mapAccountNameToCategory(undefined)).toBe('uncategorized');
    expect(mapAccountNameToCategory('')).toBe('uncategorized');
  });
});

describe('mapPaymentAccount', () => {
  it('matches the real QuickBooks account names exactly', () => {
    expect(mapPaymentAccount('BUS COMPLETE CHK (5039)')).toBe('operating-checking');
    expect(mapPaymentAccount('Blue Business Plus Card (1002)')).toBe('business-card');
    expect(mapPaymentAccount('R. MULLINEAUX (9898)')).toBe('mullineaux-card');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(mapPaymentAccount('  r. mullineaux (9898)  ')).toBe('mullineaux-card');
  });

  it('never guesses between the two credit cards', () => {
    // Card-like but not a configured name: two cards exist, so guessing would
    // put spend on the wrong one. Leave it unassigned instead.
    expect(mapPaymentAccount('Some Other Visa Card')).toBeNull();
  });

  it('still falls back for checking, where only one account exists', () => {
    expect(mapPaymentAccount('Business Bank Account')).toBe('operating-checking');
  });

  it('returns null when unknown or missing', () => {
    expect(mapPaymentAccount('Petty Llama Fund')).toBeNull();
    expect(mapPaymentAccount(undefined)).toBeNull();
  });
});

describe('purchaseToTransaction', () => {
  const base: QboPurchase = {
    Id: '145',
    TxnDate: '2026-08-01',
    TotalAmt: 812.4,
    PaymentType: 'CreditCard',
    AccountRef: { value: '42', name: 'Blue Business Plus Card (1002)' },
    EntityRef: { value: '7', name: 'Sherwin-Williams' },
    Line: [
      {
        Amount: 812.4,
        Description: '5-gal epoxy + hardener',
        DetailType: 'AccountBasedExpenseLineDetail',
        AccountBasedExpenseLineDetail: { AccountRef: { value: '9', name: 'Job Materials' } },
      },
    ],
  };

  it('maps a complete purchase', () => {
    const t = purchaseToTransaction(base);
    expect(t).not.toBeNull();
    expect(t!.qbo_id).toBe('145');
    expect(t!.date).toBe('2026-08-01');
    expect(t!.amount).toBe(812.4);
    expect(t!.description).toBe('Sherwin-Williams — 5-gal epoxy + hardener');
    expect(t!.category_id).toBe('materials');
    expect(t!.account_id).toBe('business-card');
    expect(t!.source).toBe('quickbooks');
  });

  it('negates the amount for credits (refunds)', () => {
    const t = purchaseToTransaction({ ...base, Credit: true });
    expect(t!.amount).toBe(-812.4);
  });

  it('returns null (never throws) without an Id', () => {
    expect(purchaseToTransaction({ TxnDate: '2026-08-01', TotalAmt: 5 })).toBeNull();
  });

  it('degrades gracefully when optional fields are missing', () => {
    const t = purchaseToTransaction({ Id: '9' });
    expect(t).not.toBeNull();
    expect(t!.qbo_id).toBe('9');
    expect(t!.amount).toBe(0);
    expect(t!.category_id).toBe('uncategorized');
    expect(t!.account_id).toBeNull();
    expect(t!.description).toBe('QuickBooks purchase 9');
    expect(typeof t!.date).toBe('string');
  });

  it('falls back to PrivateNote when lines have no description', () => {
    const t = purchaseToTransaction({
      ...base,
      Line: [],
      PrivateNote: 'Dumpster pull for Kettle Ridge',
    });
    expect(t!.description).toBe('Sherwin-Williams — Dumpster pull for Kettle Ridge');
  });
});
