import { test, expect } from '@playwright/test';

/**
 * Smoke test over the fixture-data path (E2E_FIXTURE_MODE=1, no Supabase, no
 * Jobber). Asserts every dashboard route returns 200 and renders its heading.
 */
const ROUTES: { path: string; heading: RegExp }[] = [
  { path: '/', heading: /Overview/ },
  { path: '/leads', heading: /Leads/ },
  { path: '/jobs', heading: /Jobs/ },
  { path: '/jobs/job-1001', heading: /Warehouse epoxy/ },
  { path: '/quotes', heading: /Quotes & Invoices/ },
  { path: '/spending', heading: /Spending/ },
  { path: '/materials', heading: /Materials & Equipment/ },
  { path: '/marketing', heading: /Marketing/ },
  { path: '/settings', heading: /Settings/ },
];

for (const route of ROUTES) {
  test(`${route.path} returns 200 and renders its heading`, async ({ page }) => {
    const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), `HTTP status for ${route.path}`).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: route.heading })).toBeVisible();
  });
}

test('login page renders and is reachable', async ({ page }) => {
  const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.getByText('Operations Dashboard')).toBeVisible();
});

test('unknown job shows a friendly not-found', async ({ page }) => {
  await page.goto('/jobs/does-not-exist', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Job not found')).toBeVisible();
});

// Responsive: the page body must never scroll horizontally at phone width.
test.describe('mobile @ 375px has no horizontal overflow', () => {
  test.use({ viewport: { width: 375, height: 800 } });
  for (const path of ['/', '/jobs', '/jobs/job-1001', '/spending', '/settings']) {
    test(`${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // Allow 1px for sub-pixel rounding.
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
    });
  }
});
