import { test, expect } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';

test.describe('F06–F10: Search, notifications and messaging', () => {
  test('searches posts and people with the two tabs', async ({ page }) => {
    await page.goto('/search?q=test');
    await expect(page.locator('#search-page-input')).toHaveValue('test');
    await expect(page.getByRole('tab', { name: 'Posts' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'People' })).toBeVisible();
    await page.getByRole('tab', { name: 'People' }).click();
    await expect(page).toHaveURL(/tab=users/);
    await checkA11y(page, 'Search Page');
  });

  test('renders the notifications page and passes the accessibility audit', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    await checkA11y(page, 'Notifications Page');
  });

  test('renders the messages workspace and passes the accessibility audit', async ({ page }) => {
    await page.goto('/messages');
    await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible();
    await checkA11y(page, 'Messages Workspace');
  });

  test('renders settings with every section', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    for (const section of [
      'Profile',
      'Email',
      'Password',
      'Sessions',
      'Blocked accounts',
      'Your data',
      'Delete account',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible();
    }
    await checkA11y(page, 'Settings Page');
  });
});
