import { test, expect } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';

test.describe('F02–F05: Posts, feeds, likes, comments and reshares', () => {
  test('creates a post through the composer and sees it in the feed', async ({ page }) => {
    await page.goto('/');
    const postContent = `E2E Playwright test post content ${Date.now()} verifying end to end functionality.`;
    await page.locator('#composer-body').fill(postContent);
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.getByText(postContent)).toBeVisible();
  });

  test('likes and unlikes a post with an immediate optimistic state update', async ({ page }) => {
    await page.goto('/');
    const article = page.locator('article').first();
    const likeButton = article.getByRole('button', { name: /^(Like|Remove like), / });
    await expect(likeButton).toBeVisible();
    const before = await likeButton.getAttribute('aria-pressed');
    await likeButton.click();
    await expect(likeButton).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
    await likeButton.click();
    await expect(likeButton).toHaveAttribute('aria-pressed', before ?? 'false');
  });

  test('opens a post, comments, and passes the accessibility audit', async ({ page }) => {
    await page.goto('/');
    await page.locator('article a[href*="/p/"]').first().click();
    await expect(page).toHaveURL(/\/p\//);

    const commentText = `Great discussion on verified information ${Date.now()}`;
    await page.locator('#comment-body').fill(commentText);
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    await expect(page.getByText(commentText)).toBeVisible();
    await checkA11y(page, 'Post Detail Page');
  });

  test('opens the share dialog and cancels it', async ({ page }) => {
    await page.goto('/');
    // Share is disabled on the viewer's own posts; take the first enabled one.
    const shareButton = page
      .getByRole('button', { name: /^Share, / })
      .and(page.locator(':enabled'))
      .first();
    await expect(shareButton).toBeVisible();
    await shareButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await checkA11y(page, 'Share dialog');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});
