/**
 * business.config.ts — SINGLE SOURCE OF TRUTH for business identity, financial
 * accounts, and spending categories.
 *
 * Never hardcode "Resin Pros", account names, or category strings anywhere else
 * in the app. Import from here. If a value is wrong, it is wrong in exactly one
 * place.
 *
 * Values marked `// TODO(andrew)` are best-guess placeholders for the two owners
 * to confirm; they are safe defaults and do not block the app from running.
 */

export interface FinancialAccount {
  /** Stable id used in transaction records + CSV import mapping. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  /** Institution, for the owner's reference. */
  institution: string;
  /** Last 4 digits, for disambiguating statements. Optional. */
  last4?: string;
  type: 'checking' | 'credit_card' | 'savings';
}

export interface SpendingCategory {
  /** Stable id stored on transactions. */
  id: string;
  label: string;
  /** Whether this category counts as a direct job cost (COGS) vs. overhead. */
  jobCost: boolean;
}

export interface BusinessConfig {
  /** Legal entity name. */
  legalName: string;
  /** Short display name used in the sidebar / page titles. */
  displayName: string;
  /** Trade / DBA, if any. */
  tradeName: string;
  tagline: string;
  contact: {
    phone: string;
    email: string;
    /** Physical / mailing address, single line. */
    address: string;
    /** Timezone used for schedule rendering + "business hours" math. */
    timezone: string;
  };
  /** The two people who use this dashboard. */
  owners: { name: string; role: string }[];
  /** Bank + card accounts spending is reconciled against. */
  accounts: FinancialAccount[];
  /** Spending categories used on the spending page + CSV import. */
  spendingCategories: SpendingCategory[];
  currency: {
    code: string;
    /** Intl locale for formatting money + dates. */
    locale: string;
  };
}

export const businessConfig: BusinessConfig = {
  legalName: 'Resin Pros Flooring LLC',
  displayName: 'Resin Pros',
  tradeName: 'Resin Pros Flooring',
  tagline: 'Commercial & industrial resin flooring and polished concrete',

  contact: {
    phone: '(000) 000-0000', // TODO(andrew): confirm business line
    email: 'office@resinprosflooring.com', // TODO(andrew): confirm
    address: '', // TODO(andrew): confirm mailing address
    timezone: 'America/New_York', // TODO(andrew): confirm operating timezone
  },

  owners: [
    { name: 'Andrew', role: 'Owner' },
    { name: 'Partner', role: 'Business Partner' }, // TODO(andrew): confirm partner name
  ],

  // Accounts spending is reconciled against. Ids are referenced by imported
  // transactions; keep them stable once real statements start flowing in.
  accounts: [
    {
      id: 'operating-checking',
      label: 'Operating Checking',
      institution: 'Business Bank', // TODO(andrew)
      type: 'checking',
    },
    {
      id: 'business-card',
      label: 'Business Card',
      institution: 'Business Bank', // TODO(andrew)
      type: 'credit_card',
    },
  ],

  // Spending categories. `jobCost: true` means the spend rolls into a job's
  // direct cost; `false` is overhead (rent, software, marketing, etc.).
  spendingCategories: [
    { id: 'materials', label: 'Materials (resin, aggregate, sealer)', jobCost: true },
    { id: 'equipment-rental', label: 'Equipment Rental', jobCost: true },
    { id: 'equipment-purchase', label: 'Equipment Purchase', jobCost: false },
    { id: 'subcontractor', label: 'Subcontractor / Labor', jobCost: true },
    { id: 'fuel-travel', label: 'Fuel & Travel', jobCost: true },
    { id: 'disposal', label: 'Disposal / Dumpster', jobCost: true },
    { id: 'permits', label: 'Permits & Fees', jobCost: true },
    { id: 'insurance', label: 'Insurance', jobCost: false },
    { id: 'software', label: 'Software & Subscriptions', jobCost: false },
    { id: 'marketing', label: 'Marketing & Advertising', jobCost: false },
    { id: 'office-admin', label: 'Office & Admin', jobCost: false },
    { id: 'uncategorized', label: 'Uncategorized', jobCost: false },
  ],

  currency: {
    code: 'USD',
    locale: 'en-US',
  },
};

/** Convenience: look up a spending category by id, falling back to Uncategorized. */
export function getCategory(id: string | null | undefined): SpendingCategory {
  const found = businessConfig.spendingCategories.find((c) => c.id === id);
  return found ?? businessConfig.spendingCategories.find((c) => c.id === 'uncategorized')!;
}

/** Convenience: look up an account by id. */
export function getAccount(id: string | null | undefined): FinancialAccount | undefined {
  return businessConfig.accounts.find((a) => a.id === id);
}

/** Format a number as money in the configured currency/locale. */
export function formatMoney(amount: number): string {
  return new Intl.NumberFormat(businessConfig.currency.locale, {
    style: 'currency',
    currency: businessConfig.currency.code,
  }).format(amount);
}
