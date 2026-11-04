import { test, expect } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';
import { ANON_STATE, loginUser } from './helpers/auth.js';

test.describe('F01: Authentication, registration and accessibility', () => {
  const timestamp = Date.now();
  const testUsername = `user_${timestamp.toString().slice(-6)}`;
  const testEmail = `${testUsername}@example.local`;
  const testPassword = 'StrongPassword123!';

  test.describe('signed out', () => {
    test.use({ storageState: ANON_STATE });

    test('renders the login page with valid WCAG 2.1 AA accessibility', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      await checkA11y(page, 'Login Page');
    });

    test('registers a new user and lands on the feed able to post', async ({ page }) => {
      await page.goto('/register');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await checkA11y(page, 'Register Page');

      await page.fill('#register-username', testUsername);
      await page.fill('#register-email', testEmail);
      await page.fill('#register-password', testPassword);
      await page.fill('#register-displayName', `Display ${testUsername}`);
      await page.click('button[type="submit"]');

      // No email verification step (DEC-017): a new member can post straight away.
      await expect(page).toHaveURL('/');
      await expect(page.locator('#composer-body')).toBeEnabled();
    });

    test('signs in an existing user through the form and renders the shell', async ({ page }) => {
      await loginUser(page, 'e2eadmin', 'AdminPass123!');
      await expect(page).toHaveURL('/');
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
      await checkA11y(page, 'Home Dashboard');
    });
  });

  test('renders the profile page with details and tabs', async ({ page }) => {
    await page.goto('/u/e2eadmin');
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Administrator' })).toBeVisible();
    await expect(page.getByText('@e2eadmin').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Followers/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Following/ })).toBeVisible();
    await checkA11y(page, 'Profile Page');
  });
});
