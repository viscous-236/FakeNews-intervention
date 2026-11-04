import { test, expect } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';

test.describe('F11–F14: Score transparency, admin governance and appeals', () => {
  test('F11: renders the score page with the KPI strip, ledger and events', async ({ page }) => {
    await page.goto('/score');
    await expect(page.getByRole('heading', { level: 1, name: 'My score' })).toBeVisible();
    await expect(page.getByText('Score Q', { exact: true })).toBeVisible();
    await expect(page.getByText('Sensitivity σ', { exact: true })).toBeVisible();
    await expect(page.getByText('Q(w+1) = Q(w) + σ × R(w)').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Wave ledger' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Events' })).toBeVisible();
    await checkA11y(page, 'Score Transparency Page');
  });

  test('F12: renders the admin overview and the review queue', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByText('Detection pipeline')).toBeVisible();
    await checkA11y(page, 'Admin Overview Page');

    await page.goto('/admin/queue');
    await expect(page.getByRole('heading', { level: 1, name: 'Review queue' })).toBeVisible();
    await checkA11y(page, 'Admin Review Queue');
  });

  test('F13: renders the appeals page with its status tabs', async ({ page }) => {
    await page.goto('/admin/appeals');
    await expect(page.getByRole('heading', { level: 1, name: 'Appeals' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Open' })).toBeVisible();
    await checkA11y(page, 'Admin Appeals Page');
  });

  test('F14: renders the waves page with the finalize control', async ({ page }) => {
    await page.goto('/admin/waves');
    await expect(page.getByRole('heading', { level: 1, name: 'Waves' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finalize wave' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Finalized waves' })).toBeVisible();
    await checkA11y(page, 'Admin Waves Management Page');
  });

  test('renders users, audit log, verify and analytics pages', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    await checkA11y(page, 'Admin Users Page');
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible();
    await checkA11y(page, 'Admin Audit Page');
    await page.goto('/admin/verify');
    await expect(page.getByRole('button', { name: 'Run verification' })).toBeVisible();
    await checkA11y(page, 'Admin Verify Page');
    await page.goto('/admin/analytics');
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible();
    await checkA11y(page, 'Admin Analytics Page');
  });
});
