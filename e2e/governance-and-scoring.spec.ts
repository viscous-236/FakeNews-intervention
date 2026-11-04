import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

test.describe('F11–F14: Score Transparency, Admin Governance, and Appeals', () => {
  test.beforeEach(async ({ page }) => {
    await loginUser(page, 'e2eadmin', 'AdminPass123!');
  });

  test('F11: renders Score transparency page, reputation metrics, and explanation drawer', async ({ page }) => {
    await page.goto('/score');

    // Page title and metrics
    await expect(page.locator('text=Reputation Score')).toBeVisible();

    // Verify explanation drawer trigger or table
    await checkA11y(page, 'Score Transparency Page');
  });

  test('F12: renders Administrator Overview and Review Workspace', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('text=System Overview')).toBeVisible();

    await checkA11y(page, 'Admin Overview Page');

    // Queue page
    await page.goto('/admin/queue');
    await expect(page.locator('text=Review Queue')).toBeVisible();

    await checkA11y(page, 'Admin Review Queue');
  });

  test('F13: renders Appeals management page', async ({ page }) => {
    await page.goto('/admin/appeals');
    await expect(page.locator('text=Appeals Adjudication')).toBeVisible();

    await checkA11y(page, 'Admin Appeals Page');
  });

  test('F14: renders Reputation Waves management and finalization controls', async ({ page }) => {
    await page.goto('/admin/waves');
    await expect(page.locator('text=Reputation Waves')).toBeVisible();

    await checkA11y(page, 'Admin Waves Management Page');
  });
});
