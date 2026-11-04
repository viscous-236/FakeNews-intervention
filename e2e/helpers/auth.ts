import { Page, expect } from '@playwright/test';

export async function loginUser(
  page: Page,
  identifier: string,
  password: string,
): Promise<void> {
  await page.goto('/login');
  await page.fill('#login-identifier', identifier);
  await page.fill('#login-password', password);
  await page.click('button[type="submit"]');
  // Wait until navigated away from /login
  await expect(page).not.toHaveURL(/\/login/);
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await loginUser(page, 'e2eadmin', 'AdminPass123!');
}

export async function logoutUser(page: Page): Promise<void> {
  await page.goto('/settings');
  const logoutBtn = page.locator('button:has-text("Sign Out"), button:has-text("Log out")').first();
  if (await logoutBtn.isVisible()) {
    await logoutBtn.click();
    await expect(page).toHaveURL(/\/login/);
  }
}
