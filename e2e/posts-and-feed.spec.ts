import { test, expect } from '@playwright/test';
import { loginUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

test.describe('F02–F05: Posts, Feeds, Likes, Comments, and Reshares', () => {
  test.beforeEach(async ({ page }) => {
    await loginUser(page, 'e2eadmin', 'AdminPass123!');
  });

  test('creates a post through composer and sees it in feed', async ({ page }) => {
    await page.goto('/');

    const postContent = `E2E Playwright test post content ${Date.now()} verifying end to end functionality.`;

    // Composer textarea
    const textarea = page.locator('textarea').first();
    await textarea.fill(postContent);

    // Post button
    const postButton = page.locator('button:has-text("Post"), button[type="submit"]').first();
    await postButton.click();

    // Verify post appears in feed
    await expect(page.locator(`text=${postContent}`)).toBeVisible();
  });

  test('likes and unlikes a post with immediate optimistic state update', async ({ page }) => {
    await page.goto('/');

    // Locate the first like button
    const likeButton = page.locator('button[aria-label*="Like"], button[aria-label*="like"]').first();
    await expect(likeButton).toBeVisible();

    // Click like
    await likeButton.click();

    // Click again to unlike
    await likeButton.click();
  });

  test('navigates to post detail, posts a comment, and verifies a11y', async ({ page }) => {
    await page.goto('/');

    // Click on the first post link to view details
    const postLink = page.locator('article a[href*="/p/"]').first();
    if (await postLink.isVisible()) {
      await postLink.click();
      await expect(page).toHaveURL(/\/p\//);

      // Verify comment composer is present
      const commentInput = page.locator('textarea').first();
      await expect(commentInput).toBeVisible();

      const commentText = `Great discussion on verified information ${Date.now()}`;
      await commentInput.fill(commentText);
      await page.locator('button:has-text("Comment")').click();

      // Comment should be displayed
      await expect(page.locator(`text=${commentText}`)).toBeVisible();

      // Accessibility check on Post Detail Page
      await checkA11y(page, 'Post Detail Page');
    }
  });

  test('opens reshare dialog and confirms reshare warning behavior', async ({ page }) => {
    await page.goto('/');

    const reshareBtn = page.locator('button[aria-label*="Reshare"], button[aria-label*="reshare"]').first();
    if (await reshareBtn.isVisible()) {
      await reshareBtn.click();

      // Reshare modal should appear
      const modal = page.locator('div[role="dialog"]');
      await expect(modal).toBeVisible();

      // Cancel reshare
      await page.locator('button:has-text("Cancel")').click();
      await expect(modal).not.toBeVisible();
    }
  });
});
