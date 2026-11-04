import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

test.describe('F06–F10: Social Connections, Search, Notifications, and Messaging', () => {
  test.beforeEach(async ({ page }) => {
    await loginUser(page, 'e2eadmin', 'AdminPass123!');
  });

  test('searches for posts and users with truth weighting tabs', async ({ page }) => {
    await page.goto('/search?q=test');
    await expect(page.locator('input[type="search"], input[placeholder*="Search"]')).toBeVisible();

    // Verify tabs
    await expect(page.locator('button:has-text("Posts")')).toBeVisible();
    await expect(page.locator('button:has-text("Users")')).toBeVisible();

    await checkA11y(page, 'Search Page');
  });

  test('navigates to notifications page and verifies layout and a11y', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.locator('h1, h2')).toContainText(['Notifications']);

    await checkA11y(page, 'Notifications Page');
  });

  test('navigates to direct messages and verifies chat workspace', async ({ page }) => {
    await page.goto('/messages');
    await expect(page.locator('text=Messages')).toBeVisible();

    await checkA11y(page, 'Messages Workspace');
  });
});
