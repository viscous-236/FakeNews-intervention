/**
 * apps/api/test/modules/users/createUser.test.ts (TASK-016)
 *
 * Tests for createUser service & scripts:
 *   - Creates user with argon2id hash and requested sigma
 *   - Creates admin user with requested sigma
 *   - Rejects sigma < 0 or > 1
 *   - Sets email_verified_at when requested
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUser, verifyPassword } from '../../../src/modules/users/service.js';
import { closeTestPool, truncateAll } from '../../setup/db.js';

describe('createUser (TASK-016)', () => {
  beforeAll(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it('creates user with requested sigma and argon2id password hash', async () => {
    const user = await createUser({
      username: 'test_user_1',
      email: 'user1@example.com',
      password: 'validPassword123!',
      displayName: 'Test User One',
      sigma: 0.750,
      emailVerified: true,
    });

    expect(user.username).toBe('test_user_1');
    expect(user.role).toBe('user');
    expect(parseFloat(user.sigma)).toBe(0.750);
    expect(user.email_verified_at).not.toBeNull();
    expect(user.password_hash).toMatch(/^\$argon2id\$/);

    const valid = await verifyPassword(user.password_hash, 'validPassword123!');
    expect(valid).toBe(true);
  });

  it('created admin has requested sigma and role admin', async () => {
    const admin = await createUser({
      username: 'test_admin_1',
      email: 'admin1@example.com',
      password: 'adminPassword123!',
      displayName: 'Test Admin One',
      role: 'admin',
      sigma: 0.250,
      emailVerified: true,
    });

    expect(admin.username).toBe('test_admin_1');
    expect(admin.role).toBe('admin');
    expect(parseFloat(admin.sigma)).toBe(0.250);
  });

  it('defaults sigma to config.SIGMA_DEFAULT (0.500) when omitted', async () => {
    const user = await createUser({
      username: 'test_user_default',
      email: 'default@example.com',
      password: 'password12345',
      displayName: 'Default Sigma',
    });

    expect(parseFloat(user.sigma)).toBe(0.500);
    expect(user.email_verified_at).toBeNull();
  });

  it('rejects sigma outside [0, 1] with negative value', async () => {
    await expect(
      createUser({
        username: 'test_bad_sigma',
        email: 'bad@example.com',
        password: 'password12345',
        displayName: 'Bad Sigma',
        sigma: -0.1,
      }),
    ).rejects.toThrow('sigma must be between 0 and 1');
  });

  it('rejects sigma outside [0, 1] with value > 1', async () => {
    await expect(
      createUser({
        username: 'test_bad_sigma_2',
        email: 'bad2@example.com',
        password: 'password12345',
        displayName: 'Bad Sigma 2',
        sigma: 1.001,
      }),
    ).rejects.toThrow('sigma must be between 0 and 1');
  });
});
