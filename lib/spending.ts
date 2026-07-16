/**
 * Pure aggregation math for the spending page. No I/O — takes already-loaded
 * jobs/costs and produces rollups. Unit-tested (lib/spending.test.ts).
 */

import { businessConfig, getCategory } from '@/config/business.config';
import type { Job, JobCost } from '@/lib/db/types';

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

/** Roll costs up per job and compute margin. Jobs with no costs are included. */
export function rollupJobCosts(jobs: Job[], costs: JobCost[]): JobCostRollup[] {
  const byJob = new Map<string, JobCost[]>();
  for (const cost of costs) {
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

/** Total costs grouped by spending category, sorted highest-first. */
export function rollupByCategory(costs: JobCost[]): CategoryRollup[] {
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
export function spendingTotals(costs: JobCost[]): SpendingTotals {
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
