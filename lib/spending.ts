/**
 * Pure aggregation math for the spending page. No I/O — takes already-loaded
 * jobs/costs and produces rollups. Unit-tested (lib/spending.test.ts).
 */

import { businessConfig, getCategory } from '@/config/business.config';
import type { Job, JobCost, Transaction } from '@/lib/db/types';

/**
 * The common shape every spend rollup works on.
 *
 * Spend reaches the dashboard through two disjoint tables: `job_costs` (costs
 * attributed to a specific job, entered by hand) and `transactions` (CSV
 * statement imports and the QuickBooks sync). Neither writes to the other, so
 * concatenating them cannot double-count.
 *
 * `jobId` is optional here: a transaction is only attributed to a job once
 * someone says so, and unattributed spend still belongs in the totals.
 */
export interface SpendItem {
  categoryId: string;
  amount: number;
  jobId?: string;
  accountId?: string;
}

/** Merge both spend sources into one list for the rollups below. */
export function toSpendItems(costs: JobCost[], transactions: Transaction[] = []): SpendItem[] {
  return [
    ...costs.map((c) => ({ categoryId: c.categoryId, amount: c.amount, jobId: c.jobId, accountId: c.accountId })),
    ...transactions.map((t) => ({ categoryId: t.categoryId, amount: t.amount, jobId: t.jobId, accountId: t.accountId })),
  ];
}

export interface AccountRollup {
  accountId: string | null;
  label: string;
  /** Last 4 digits, when known. */
  last4?: string;
  type: 'checking' | 'credit_card' | 'savings' | 'unassigned';
  total: number;
  count: number;
}

/**
 * Total spend per financial account, in configured order.
 *
 * Every configured account is returned even at zero, so the owner can see all
 * three accounts rather than only the ones that happen to have activity. Spend
 * that couldn't be matched to an account is grouped into a trailing
 * "Unassigned" row instead of being hidden — a silent drop here would make the
 * per-account totals quietly disagree with the headline total.
 */
export function rollupByAccount(items: SpendItem[]): AccountRollup[] {
  const rows: AccountRollup[] = businessConfig.accounts.map((a) => ({
    accountId: a.id,
    label: a.label,
    last4: a.last4,
    type: a.type,
    total: 0,
    count: 0,
  }));
  const unassigned: AccountRollup = {
    accountId: null,
    label: 'Unassigned',
    type: 'unassigned',
    total: 0,
    count: 0,
  };

  for (const item of items) {
    const amount = Number.isFinite(item.amount) ? item.amount : 0;
    const row = rows.find((r) => r.accountId === item.accountId) ?? unassigned;
    row.total += amount;
    row.count += 1;
  }

  return unassigned.count > 0 ? [...rows, unassigned] : rows;
}

export interface JobCostRollup {
  jobId: string;
  title: string;
  clientName: string;
  /** Contract value of the job. */
  value: number;
  /** All costs attributed to the job. */
  totalCost: number;
  /** value - totalCost. */
  margin: number;
  /** Margin as a fraction of value (0..1), or null when value is 0. */
  marginPct: number | null;
  costCount: number;
}

export interface CategoryRollup {
  categoryId: string;
  label: string;
  total: number;
  jobCost: boolean;
}

/** Sum an array of things that have an `amount`. */
export function sumAmount(items: { amount: number }[]): number {
  return items.reduce((acc, i) => acc + (Number.isFinite(i.amount) ? i.amount : 0), 0);
}

/**
 * Roll spend up per job and compute margin. Jobs with no costs are included.
 * Items with no jobId are unattributed overhead and are skipped here — they
 * still count in spendingTotals and rollupByCategory.
 */
export function rollupJobCosts(jobs: Job[], costs: SpendItem[]): JobCostRollup[] {
  const byJob = new Map<string, SpendItem[]>();
  for (const cost of costs) {
    if (!cost.jobId) continue;
    const list = byJob.get(cost.jobId);
    if (list) list.push(cost);
    else byJob.set(cost.jobId, [cost]);
  }
  return jobs.map((job) => {
    const jobCosts = byJob.get(job.id) ?? [];
    const totalCost = sumAmount(jobCosts);
    const margin = job.value - totalCost;
    return {
      jobId: job.id,
      title: job.title,
      clientName: job.clientName,
      value: job.value,
      totalCost,
      margin,
      marginPct: job.value > 0 ? margin / job.value : null,
      costCount: jobCosts.length,
    };
  });
}

/** Total spend grouped by spending category, sorted highest-first. */
export function rollupByCategory(costs: SpendItem[]): CategoryRollup[] {
  const totals = new Map<string, number>();
  for (const cost of costs) {
    totals.set(cost.categoryId, (totals.get(cost.categoryId) ?? 0) + (Number.isFinite(cost.amount) ? cost.amount : 0));
  }
  return [...totals.entries()]
    .map(([categoryId, total]) => {
      const cat = getCategory(categoryId);
      return { categoryId, label: cat.label, total, jobCost: cat.jobCost };
    })
    .sort((a, b) => b.total - a.total);
}

export interface SpendingTotals {
  total: number;
  jobCostTotal: number;
  overheadTotal: number;
}

/** Split total spend into direct job cost (COGS) vs overhead. */
export function spendingTotals(costs: SpendItem[]): SpendingTotals {
  let jobCostTotal = 0;
  let overheadTotal = 0;
  for (const cost of costs) {
    const amt = Number.isFinite(cost.amount) ? cost.amount : 0;
    if (getCategory(cost.categoryId).jobCost) jobCostTotal += amt;
    else overheadTotal += amt;
  }
  return { total: jobCostTotal + overheadTotal, jobCostTotal, overheadTotal };
}

/** All category ids, for allocation UIs. */
export const ALL_CATEGORY_IDS = businessConfig.spendingCategories.map((c) => c.id);
