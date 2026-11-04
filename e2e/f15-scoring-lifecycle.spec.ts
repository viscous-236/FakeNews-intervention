import { test, expect } from '@playwright/test';

/**
 * F15 (TEST-108): the scoring lifecycle as the user sees it. The numerical
 * assertions on like penalties, retraction before finalization and ledger
 * immutability run against the real database in apps/api/test (TEST-029 to
 * TEST-033); this spec checks the screens that expose them.
 */
test.describe('F15: Scoring lifecycle on screen', () => {
  test('score page, composer, events and waves work together', async ({ page }) => {
    await page.goto('/score');
    await expect(page.getByRole('heading', { level: 1, name: 'My score' })).toBeVisible();
    const pending = page.getByRole('heading', { level: 2, name: 'Pending in this wave' });
    await expect(pending).toBeVisible();
    await expect(page.getByText('Projected change σ × R').first()).toBeVisible();

    await page.goto('/');
    const body = `Post created for F15 scoring lifecycle test ${Date.now()} with unique identification.`;
    await page.locator('#composer-body').fill(body);
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.getByText(body)).toBeVisible();
    // The author sees the automated-check status on their own post; nobody else does.
    await expect(page.getByText(/Automated check/).first()).toBeVisible();

    await page.goto('/admin/waves');
    await expect(page.getByRole('heading', { level: 1, name: 'Waves' })).toBeVisible();
    await expect(page.getByText(/Wave \d+ is open/)).toBeVisible();
    await expect(page.getByText('Eligible events')).toBeVisible();
  });
});
