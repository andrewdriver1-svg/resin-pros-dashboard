import { describe, it, expect } from 'vitest';
import { rollupJobCosts, rollupByCategory, spendingTotals, sumAmount, toSpendItems } from './spending';
import type { Job, JobCost, Transaction } from './db/types';

const jobs: Job[] = [
  { id: 'j1', title: 'Warehouse', clientName: 'Kettle', status: 'in_progress', value: 10000 },
  { id: 'j2', title: 'Showroom', clientName: 'Apex', status: 'scheduled', value: 5000 },
  { id: 'j3', title: 'No costs', clientName: 'Nobody', status: 'complete', value: 2000 },
];

const costs: JobCost[] = [
  { id: 'c1', jobId: 'j1', categoryId: 'materials', description: 'resin', amount: 3000, date: '2026-07-01', source: 'manual' },
  { id: 'c2', jobId: 'j1', categoryId: 'equipment-rental', description: 'grinder', amount: 500, date: '2026-07-02', source: 'manual' },
  { id: 'c3', jobId: 'j2', categoryId: 'materials', description: 'densifier', amount: 1200, date: '2026-07-03', source: 'manual' },
  { id: 'c4', jobId: 'j1', categoryId: 'software', description: 'overhead', amount: 100, date: '2026-07-04', source: 'manual' },
];

// Spend that arrives via the transactions table (QuickBooks sync / CSV import).
const transactions: Transaction[] = [
  // Unattributed overhead — must count in totals but not against any job.
  { id: 't1', date: '2026-08-01', description: 'Sherwin-Williams', amount: 800, categoryId: 'materials', source: 'quickbooks' },
  { id: 't2', date: '2026-08-02', description: 'Insurance', amount: 250, categoryId: 'insurance', source: 'quickbooks' },
  // Attributed to a job — must roll into that job's cost.
  { id: 't3', date: '2026-08-03', description: 'Dumpster', amount: 400, categoryId: 'disposal', jobId: 'j2', source: 'csv_import' },
];

describe('toSpendItems', () => {
  it('merges both spend sources without dropping or double-counting', () => {
    const items = toSpendItems(costs, transactions);
    expect(items).toHaveLength(costs.length + transactions.length);
    expect(sumAmount(items)).toBe(4800 + 1450);
  });

  it('treats transactions as optional so job costs alone still work', () => {
    expect(toSpendItems(costs)).toHaveLength(costs.length);
  });

  it('preserves jobId only where one was set', () => {
    const items = toSpendItems([], transactions);
    expect(items.map((i) => i.jobId)).toEqual([undefined, undefined, 'j2']);
  });
});

describe('sumAmount', () => {
  it('sums amounts and ignores non-finite values', () => {
    expect(sumAmount([{ amount: 10 }, { amount: 20 }])).toBe(30);
    expect(sumAmount([{ amount: 10 }, { amount: NaN }])).toBe(10);
  });
});

describe('rollupJobCosts', () => {
  it('sums costs per job and computes margin', () => {
    const rollups = rollupJobCosts(jobs, costs);
    const j1 = rollups.find((r) => r.jobId === 'j1')!;
    expect(j1.totalCost).toBe(3600); // 3000 + 500 + 100
    expect(j1.margin).toBe(6400); // 10000 - 3600
    expect(j1.marginPct).toBeCloseTo(0.64);
    expect(j1.costCount).toBe(3);
  });

  it('includes jobs with no costs (full margin)', () => {
    const rollups = rollupJobCosts(jobs, costs);
    const j3 = rollups.find((r) => r.jobId === 'j3')!;
    expect(j3.totalCost).toBe(0);
    expect(j3.margin).toBe(2000);
    expect(j3.costCount).toBe(0);
  });

  it('returns null marginPct when the job value is 0', () => {
    const rollups = rollupJobCosts([{ ...jobs[0], value: 0 }], costs);
    expect(rollups[0].marginPct).toBeNull();
  });

  it('does not attribute costs to the wrong job', () => {
    const rollups = rollupJobCosts(jobs, costs);
    expect(rollups.find((r) => r.jobId === 'j2')!.totalCost).toBe(1200);
  });

  it('rolls job-attributed transactions in alongside job costs', () => {
    const rollups = rollupJobCosts(jobs, toSpendItems(costs, transactions));
    // j2: 1200 job cost + 400 dumpster transaction
    expect(rollups.find((r) => r.jobId === 'j2')!.totalCost).toBe(1600);
  });

  it('ignores unattributed transactions instead of misassigning them', () => {
    const rollups = rollupJobCosts(jobs, toSpendItems([], transactions));
    // Only the dumpster has a jobId; the other 1050 must not land on any job.
    expect(rollups.reduce((sum, r) => sum + r.totalCost, 0)).toBe(400);
  });
});

describe('rollupByCategory', () => {
  it('groups totals by category, highest first', () => {
    const rows = rollupByCategory(costs);
    expect(rows[0].categoryId).toBe('materials'); // 3000 + 1200 = 4200
    expect(rows[0].total).toBe(4200);
    expect(rows.find((r) => r.categoryId === 'materials')!.jobCost).toBe(true);
    expect(rows.find((r) => r.categoryId === 'software')!.jobCost).toBe(false);
  });

  it('includes transaction spend in the category breakdown', () => {
    const rows = rollupByCategory(toSpendItems(costs, transactions));
    // materials: 3000 + 1200 job costs + 800 from QuickBooks
    expect(rows.find((r) => r.categoryId === 'materials')!.total).toBe(5000);
    expect(rows.find((r) => r.categoryId === 'insurance')!.total).toBe(250);
    expect(rows.find((r) => r.categoryId === 'disposal')!.total).toBe(400);
  });
});

describe('spendingTotals', () => {
  it('splits spend into direct job cost vs overhead', () => {
    const totals = spendingTotals(costs);
    // job cost: materials 4200 + equipment-rental 500 = 4700; overhead: software 100
    expect(totals.jobCostTotal).toBe(4700);
    expect(totals.overheadTotal).toBe(100);
    expect(totals.total).toBe(4800);
  });

  it('counts transaction spend, attributed or not', () => {
    const totals = spendingTotals(toSpendItems(costs, transactions));
    // + materials 800 and disposal 400 (both job-cost categories), insurance 250 overhead
    expect(totals.jobCostTotal).toBe(5900);
    expect(totals.overheadTotal).toBe(350);
    expect(totals.total).toBe(6250);
  });

  it('reports QuickBooks-only spend rather than zero', () => {
    const totals = spendingTotals(toSpendItems([], transactions));
    expect(totals.total).toBe(1450);
  });
});
