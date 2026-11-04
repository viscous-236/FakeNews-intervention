import { Page, expect } from '@playwright/test';

/** Anonymous storage state for specs that must start signed out. */
export const ANON_STATE = { cookies: [], origins: [] };

export async function loginUser(page: Page, identifier: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.fill('#login-identifier', identifier);
  await page.fill('#login-password', password);
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/login/);
}

export async function logoutUser(page: Page): Promise<void> {
  await page.goto('/settings');
  const logoutBtn = page.getByRole('button', { name: 'Sign out' }).first();
  if (await logoutBtn.isVisible()) {
    await logoutBtn.click();
    await expect(page).toHaveURL(/\/login/);
  }
}
