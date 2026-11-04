import { test, expect } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';
import { loginUser } from './helpers/auth.js';

test.describe('F01: Authentication, Registration, and Accessibility', () => {
  const timestamp = Date.now();
  const testUsername = `user_${timestamp.toString().slice(-6)}`;
  const testEmail = `${testUsername}@example.local`;
  const testPassword = 'StrongPassword123!';

  test('renders login page with valid WCAG 2.1 AA accessibility', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1')).toBeVisible();
    await checkA11y(page, 'Login Page');
  });

  test('registers a new user and navigates to verification notice', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('h1')).toBeVisible();

    await page.fill('#register-username', testUsername);
    await page.fill('#register-email', testEmail);
    await page.fill('#register-password', testPassword);
    await page.fill('#register-displayName', `Display ${testUsername}`);

    await page.click('button[type="submit"]');

    // Should navigate to verify notice or login page
    await expect(page).toHaveURL(/\/(verify|login)/);
  });

  test('logs in existing user and renders home dashboard with feed', async ({ page }) => {
    await loginUser(page, 'e2eadmin', 'AdminPass123!');
    await expect(page).toHaveURL('/');

    // Check main layout elements
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('nav')).toBeVisible();

    // Verify a11y on Home dashboard
    await checkA11y(page, 'Home Dashboard');
  });

  test('renders profile page with user details and tabs', async ({ page }) => {
    await loginUser(page, 'e2eadmin', 'AdminPass123!');
    await page.goto('/u/e2eadmin');

    await expect(page.locator('h1, h2')).toContainText(['E2E Administrator', 'e2eadmin']);
    await checkA11y(page, 'Profile Page');
  });
});
