/**
 * Domain types for the ops dashboard. These are the shapes the UI consumes,
 * independent of whether the data came from Supabase, a Jobber sync, or fixtures.
 *
 * Jobber-specific raw shapes live in lib/jobber/*; the sync layer maps them into
 * these. Keeping them separate means a Jobber field rename never ripples into
 * the UI.
 */

/** Normalized lifecycle status a job can be in, mapped from Jobber. */
export type JobStatus =
  | 'lead' // request / unscheduled opportunity
  | 'quoted' // quote sent, awaiting approval
  | 'scheduled' // work booked
  | 'in_progress' // actively being worked
  | 'complete' // work done
  | 'invoiced' // invoice issued
  | 'paid' // invoice paid
  | 'archived' // closed / lost
  | 'unknown';

export type QuoteStatus = 'draft' | 'awaiting_response' | 'approved' | 'converted' | 'archived' | 'unknown';

export type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'past_due' | 'bad_debt' | 'unknown';

export interface Lead {
  id: string;
  /** Jobber request/client id, when synced. */
  jobberId?: string;
  clientName: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Free-text of what they want. */
  summary: string;
  /** ISO timestamp the lead arrived. */
  receivedAt: string;
  /** Where it came from: 'jobber_request', 'website', 'referral', etc. */
  source: string;
  status: 'new' | 'contacted' | 'quoted' | 'won' | 'lost';
  /** Optional link to the job it became. */
  jobId?: string;
}

export interface JobCost {
  id: string;
  jobId: string;
  /** Spending category id from business.config. */
  categoryId: string;
  description: string;
  amount: number;
  /** ISO date. */
  date: string;
  accountId?: string;
  /** 'csv_import' | 'manual' | 'jobber'. */
  source: string;
}

export interface Quote {
  id: string;
  jobberId?: string;
  jobId?: string;
  number: string;
  clientName: string;
  status: QuoteStatus;
  amount: number;
  /** ISO date issued. */
  issuedAt?: string;
}

export interface Invoice {
  id: string;
  jobberId?: string;
  jobId?: string;
  number: string;
  clientName: string;
  status: InvoiceStatus;
  amount: number;
  amountPaid: number;
  /** ISO date. */
  issuedAt?: string;
  dueAt?: string;
}

export interface MaterialTodo {
  id: string;
  jobId?: string;
  /** 'material' | 'equipment'. */
  kind: 'material' | 'equipment';
  item: string;
  quantity?: string;
  status: 'needed' | 'ordered' | 'received';
  /** ISO date it's needed by (usually job start). */
  neededBy?: string;
  notes?: string;
}

export interface Job {
  id: string;
  jobberId?: string;
  title: string;
  clientName: string;
  address?: string;
  status: JobStatus;
  /** ISO timestamp work is/was scheduled to start. */
  scheduledAt?: string;
  /** ISO timestamp work ended. */
  completedAt?: string;
  /** Contract / total value in dollars. */
  value: number;
  notes?: string;
}

/** A job with everything linked, for the detail page. */
export interface JobDetail extends Job {
  quotes: Quote[];
  invoices: Invoice[];
  costs: JobCost[];
  todos: MaterialTodo[];
}

export interface MarketingEntry {
  id: string;
  channel: string;
  /** ISO date (first of the month) the entry covers. */
  period: string;
  spend: number;
  leads: number;
  /** Jobs won attributed to the channel. */
  wonJobs: number;
  notes?: string;
}

export interface GoogleBusinessSnapshot {
  rating: number;
  reviewCount: number;
  phone: string;
  hours: string;
  profileStrengthOk: boolean;
  facebookFollowers: number;
  instagramFollowers: number;
  /** ISO timestamp Andrew last updated it by hand. */
  updatedAt: string;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  categoryId: string;
  accountId?: string;
  /** Job this spend is attributed to, if any. */
  jobId?: string;
  source: string;
}
