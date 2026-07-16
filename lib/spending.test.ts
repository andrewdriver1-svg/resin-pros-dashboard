import { describe, it, expect } from 'vitest';
import { rollupJobCosts, rollupByCategory, spendingTotals, sumAmount } from './spending';
import type { Job, JobCost } from './db/types';

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
});

describe('rollupByCategory', () => {
  it('groups totals by category, highest first', () => {
    const rows = rollupByCategory(costs);
    expect(rows[0].categoryId).toBe('materials'); // 3000 + 1200 = 4200
    expect(rows[0].total).toBe(4200);
    expect(rows.find((r) => r.categoryId === 'materials')!.jobCost).toBe(true);
    expect(rows.find((r) => r.categoryId === 'software')!.jobCost).toBe(false);
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
});
