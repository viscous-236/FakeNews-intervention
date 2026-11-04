import { request, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Signs the E2E administrator in once and saves the session as storage state.
 * Specs reuse it instead of logging in per test, which would trip the plan's
 * login rate limit (10 per minute per IP).
 */
export const ADMIN_STATE = path.resolve(__dirname, '.auth/admin.json');

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    (config.projects[0]?.use.baseURL as string | undefined) ?? 'http://localhost:5173';
  mkdirSync(path.dirname(ADMIN_STATE), { recursive: true });
  const context = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  const res = await context.post('/api/v1/auth/login', {
    data: { identifier: 'e2eadmin', password: 'AdminPass123!' },
  });
  if (!res.ok()) {
    throw new Error(
      `E2E admin login failed (${res.status()}). Create it with: npx tsx scripts/create-admin.ts --username e2eadmin --email e2eadmin@example.com --password 'AdminPass123!' --display-name 'E2E Administrator'`,
    );
  }
  await context.storageState({ path: ADMIN_STATE });
  await context.dispose();
}
