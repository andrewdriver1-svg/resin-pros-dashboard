/**
 * Fixture data — the pre-Supabase fallback so `npm run dev` works with zero
 * setup. Every data-layer read in lib/db/index.ts falls back to these when
 * Supabase isn't configured. Kept deliberately small but internally consistent:
 * jobs reference real quote/invoice/cost/todo ids, leads convert into jobs, etc.
 *
 * Dates are static ISO strings (no Date.now()) so fixtures render deterministically.
 */

import type {
  GoogleBusinessSnapshot,
  Invoice,
  Job,
  JobCost,
  Lead,
  MarketingEntry,
  MaterialTodo,
  Quote,
  Transaction,
} from './types';

export const fixtureJobs: Job[] = [
  {
    id: 'job-1001',
    jobberId: 'Z2lkOi8vSm9iYmVyL0pvYi8xMDAx',
    title: 'Warehouse epoxy floor — 12,000 sqft',
    clientName: 'Kettle Ridge Distribution',
    address: '4400 Industrial Pkwy, Rochester, NY',
    status: 'in_progress',
    scheduledAt: '2026-07-14T12:00:00.000Z',
    value: 48500,
    notes: 'Two-day mobilization. Moisture test passed 07/10.',
  },
  {
    id: 'job-1002',
    jobberId: 'Z2lkOi8vSm9iYmVyL0pvYi8xMDAy',
    title: 'Showroom polished concrete',
    clientName: 'Apex Auto Group',
    address: '88 Commerce Dr, Henrietta, NY',
    status: 'scheduled',
    scheduledAt: '2026-07-21T13:00:00.000Z',
    value: 22750,
  },
  {
    id: 'job-1003',
    jobberId: 'Z2lkOi8vSm9iYmVyL0pvYi8xMDAz',
    title: 'Commercial kitchen urethane cement',
    clientName: 'Lakeside Catering Co.',
    address: '12 Harbor St, Webster, NY',
    status: 'complete',
    scheduledAt: '2026-06-30T12:00:00.000Z',
    completedAt: '2026-07-02T21:00:00.000Z',
    value: 16200,
  },
  {
    id: 'job-1004',
    jobberId: 'Z2lkOi8vSm9iYmVyL0pvYi8xMDA0',
    title: 'Garage flake coating — residential',
    clientName: 'M. Alvarez',
    address: '7 Cobblestone Ln, Pittsford, NY',
    status: 'paid',
    scheduledAt: '2026-06-18T12:00:00.000Z',
    completedAt: '2026-06-19T20:00:00.000Z',
    value: 4800,
  },
];

export const fixtureQuotes: Quote[] = [
  { id: 'quote-1', jobId: 'job-1001', number: 'Q-2041', clientName: 'Kettle Ridge Distribution', status: 'converted', amount: 48500, issuedAt: '2026-06-25' },
  { id: 'quote-2', jobId: 'job-1002', number: 'Q-2044', clientName: 'Apex Auto Group', status: 'approved', amount: 22750, issuedAt: '2026-07-05' },
  { id: 'quote-3', jobId: 'job-1003', number: 'Q-2039', clientName: 'Lakeside Catering Co.', status: 'converted', amount: 16200, issuedAt: '2026-06-20' },
  { id: 'quote-4', number: 'Q-2048', clientName: 'Northline Logistics', status: 'awaiting_response', amount: 61200, issuedAt: '2026-07-12' },
];

export const fixtureInvoices: Invoice[] = [
  { id: 'inv-1', jobId: 'job-1003', number: 'INV-3012', clientName: 'Lakeside Catering Co.', status: 'sent', amount: 16200, amountPaid: 0, issuedAt: '2026-07-03', dueAt: '2026-07-18' },
  { id: 'inv-2', jobId: 'job-1004', number: 'INV-3008', clientName: 'M. Alvarez', status: 'paid', amount: 4800, amountPaid: 4800, issuedAt: '2026-06-20', dueAt: '2026-07-05' },
  { id: 'inv-3', jobId: 'job-1001', number: 'INV-3015', clientName: 'Kettle Ridge Distribution', status: 'partial', amount: 24250, amountPaid: 12125, issuedAt: '2026-07-08', dueAt: '2026-07-23' },
];

export const fixtureJobCosts: JobCost[] = [
  { id: 'cost-1', jobId: 'job-1001', categoryId: 'materials', description: 'Epoxy resin + hardener (30 kits)', amount: 8400, date: '2026-07-11', accountId: 'business-card', source: 'jobber' },
  { id: 'cost-2', jobId: 'job-1001', categoryId: 'equipment-rental', description: 'Diamond grinder + vac (2 days)', amount: 620, date: '2026-07-13', accountId: 'business-card', source: 'csv_import' },
  { id: 'cost-3', jobId: 'job-1001', categoryId: 'subcontractor', description: 'Prep crew (2 helpers)', amount: 1800, date: '2026-07-14', accountId: 'operating-checking', source: 'manual' },
  { id: 'cost-4', jobId: 'job-1003', categoryId: 'materials', description: 'Urethane cement system', amount: 3900, date: '2026-06-28', accountId: 'business-card', source: 'jobber' },
  { id: 'cost-5', jobId: 'job-1003', categoryId: 'disposal', description: 'Dumpster haul', amount: 350, date: '2026-07-01', accountId: 'operating-checking', source: 'csv_import' },
  { id: 'cost-6', jobId: 'job-1004', categoryId: 'materials', description: 'Flake + polyaspartic topcoat', amount: 720, date: '2026-06-17', accountId: 'business-card', source: 'jobber' },
];

export const fixtureTodos: MaterialTodo[] = [
  { id: 'todo-1', jobId: 'job-1002', kind: 'material', item: 'Polished concrete densifier (5 gal)', quantity: '4', status: 'needed', neededBy: '2026-07-19', notes: 'Confirm sheen level with client first.' },
  { id: 'todo-2', jobId: 'job-1002', kind: 'equipment', item: 'Planetary polisher rental', quantity: '1', status: 'ordered', neededBy: '2026-07-20' },
  { id: 'todo-3', jobId: 'job-1001', kind: 'material', item: 'Broadcast flake (natural gray)', quantity: '6 boxes', status: 'received', neededBy: '2026-07-13' },
  { id: 'todo-4', kind: 'equipment', item: 'Replacement grinder segments', quantity: '2 sets', status: 'needed', notes: 'General stock — not job-specific.' },
];

export const fixtureLeads: Lead[] = [
  { id: 'lead-1', clientName: 'Northline Logistics', contactEmail: 'facilities@northline.example', contactPhone: '(585) 555-0143', summary: 'Epoxy for 18k sqft distribution floor, forklift traffic.', receivedAt: '2026-07-14T14:32:00.000Z', source: 'jobber_request', status: 'quoted' },
  { id: 'lead-2', clientName: 'Bright Dental', contactEmail: 'office@brightdental.example', summary: 'Seamless flooring for two new operatories.', receivedAt: '2026-07-15T09:05:00.000Z', source: 'website', status: 'new' },
  { id: 'lead-3', clientName: 'R. Okafor', contactPhone: '(585) 555-0198', summary: 'Basement moisture-tolerant coating, ~900 sqft.', receivedAt: '2026-07-15T11:48:00.000Z', source: 'referral', status: 'new' },
];

export const fixtureMarketing: MarketingEntry[] = [
  { id: 'mkt-1', channel: 'Google Local Services', period: '2026-07-01', spend: 900, leads: 11, wonJobs: 2, notes: 'Best CPL this quarter.' },
  { id: 'mkt-2', channel: 'Facebook / Instagram', period: '2026-07-01', spend: 400, leads: 4, wonJobs: 0 },
  { id: 'mkt-3', channel: 'Referral / word of mouth', period: '2026-07-01', spend: 0, leads: 3, wonJobs: 1 },
  { id: 'mkt-4', channel: 'Google Local Services', period: '2026-06-01', spend: 850, leads: 9, wonJobs: 3 },
];

export const fixtureTransactions: Transaction[] = [
  { id: 'txn-1', date: '2026-07-13', description: 'SUNBELT RENTALS #422', amount: 620, categoryId: 'equipment-rental', accountId: 'business-card', jobId: 'job-1001', source: 'csv_import' },
  { id: 'txn-2', date: '2026-07-11', description: 'SHERWIN RESIN SUPPLY', amount: 8400, categoryId: 'materials', accountId: 'business-card', jobId: 'job-1001', source: 'csv_import' },
  { id: 'txn-3', date: '2026-07-09', description: 'SHELL FUEL 8841', amount: 142.6, categoryId: 'fuel-travel', accountId: 'business-card', source: 'csv_import' },
  { id: 'txn-4', date: '2026-07-01', description: 'WASTE MGMT DUMPSTER', amount: 350, categoryId: 'disposal', accountId: 'operating-checking', jobId: 'job-1003', source: 'csv_import' },
  { id: 'txn-5', date: '2026-07-05', description: 'ADOBE + QUICKBOOKS', amount: 118.99, categoryId: 'software', accountId: 'business-card', source: 'csv_import' },
];

export const fixtureGoogleBusiness: GoogleBusinessSnapshot = {
  rating: 4.9,
  reviewCount: 63,
  phone: '(585) 555-0100',
  hours: 'Mon–Fri 7:00 AM – 5:00 PM',
  profileStrengthOk: true,
  facebookFollowers: 512,
  instagramFollowers: 1180,
  updatedAt: '2026-07-01T15:00:00.000Z',
};
