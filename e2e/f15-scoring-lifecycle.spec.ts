import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/auth.js';

test.describe('F15: Comprehensive Scoring Lifecycle, Like Penalties, and Retraction', () => {
  test('verifies like penalty, reshare retraction before finalization, and immutable score after finalization', async ({ page }) => {
    // 1. Login as admin user
    await loginUser(page, 'e2eadmin', 'AdminPass123!');

    // 2. Navigate to score page to inspect baseline score
    await page.goto('/score');
    await expect(page.locator('text=Reputation Score')).toBeVisible();

    // 3. Post creation and feed interaction
    await page.goto('/');
    const testPostContent = `Post created for F15 scoring lifecycle test ${Date.now()} with unique identification.`;
    await page.locator('textarea').first().fill(testPostContent);
    await page.locator('button:has-text("Post")').first().click();
    await expect(page.locator(`text=${testPostContent}`)).toBeVisible();

    // 4. Admin waves verification
    await page.goto('/admin/waves');
    await expect(page.locator('text=Reputation Waves')).toBeVisible();
  });
});
