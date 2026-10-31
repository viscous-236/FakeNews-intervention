/**
 * apps/api/test/db/cursor-errors.test.ts (TASK-019)
 *
 * Unit tests for cursor encoding/decoding and PostgreSQL error mapping.
 */

import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../../src/db/cursor.js';
import { mapPgError } from '../../src/db/errors.js';
import { AppError } from '../../src/app.js';

describe('Cursor Pagination (TASK-019)', () => {
  it('round trips valid createdAt and UUID', () => {
    const createdAt = new Date('2026-10-31T12:00:00.000Z');
    const id = 'a0000000-0000-4000-8000-000000000001';

    const cursor = encodeCursor(createdAt, id);
    expect(typeof cursor).toBe('string');
    expect(cursor).not.toContain('+');
    expect(cursor).not.toContain('/');
    expect(cursor).not.toContain('=');

    const decoded = decodeCursor(cursor);
    expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(decoded.id).toBe(id);
  });

  it('rejects empty or non-string input with VALIDATION_ERROR', () => {
    expect(() => decodeCursor('')).toThrow(AppError);
    try {
      decodeCursor('');
    } catch (err) {
      expect((err as AppError).code).toBe('VALIDATION_ERROR');
      expect((err as AppError).statusCode).toBe(400);
    }
  });

  it('rejects cursor without pipe delimiter', () => {
    const bad = Buffer.from('just-a-plain-string', 'utf8').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(AppError);
  });

  it('rejects cursor with invalid date string', () => {
    const bad = Buffer.from('not-a-date|a0000000-0000-4000-8000-000000000001', 'utf8').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(AppError);
  });

  it('rejects cursor with non-UUID id', () => {
    const bad = Buffer.from('2026-10-31T12:00:00.000Z|not-a-uuid', 'utf8').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(AppError);
  });
});

describe('Database Error Mapping (TASK-019)', () => {
  it('maps 23505 unique_violation to 409 CONFLICT', () => {
    const pgErr = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      detail: 'Key (email)=(test@example.com) already exists.',
      constraint: 'users_email_lower_uq',
    });
    const appErr = mapPgError(pgErr);
    expect(appErr.statusCode).toBe(409);
    expect(appErr.code).toBe('CONFLICT');
  });

  it('maps 23503 foreign_key_violation to 409 CONFLICT', () => {
    const pgErr = Object.assign(new Error('foreign key constraint violated'), {
      code: '23503',
      detail: 'Key (user_id)=(...) is not present in table "users".',
      constraint: 'posts_author_id_fkey',
    });
    const appErr = mapPgError(pgErr);
    expect(appErr.statusCode).toBe(409);
    expect(appErr.code).toBe('CONFLICT');
  });

  it('maps 23514 check_violation to 400 VALIDATION_ERROR', () => {
    const pgErr = Object.assign(new Error('new row violates check constraint "users_username_check"'), {
      code: '23514',
      constraint: 'users_username_check',
    });
    const appErr = mapPgError(pgErr);
    expect(appErr.statusCode).toBe(400);
    expect(appErr.code).toBe('VALIDATION_ERROR');
  });

  it('maps 57014 query_canceled to 503 UNAVAILABLE', () => {
    const pgErr = Object.assign(new Error('canceling statement due to statement timeout'), {
      code: '57014',
    });
    const appErr = mapPgError(pgErr);
    expect(appErr.statusCode).toBe(503);
    expect(appErr.code).toBe('UNAVAILABLE');
  });

  it('passes through existing AppError', () => {
    const original = new AppError(404, 'NOT_FOUND', 'Not found');
    const result = mapPgError(original);
    expect(result).toBe(original);
  });

  it('maps unhandled errors to 500 INTERNAL', () => {
    const err = new Error('Unknown db error');
    const result = mapPgError(err);
    expect(result.statusCode).toBe(500);
    expect(result.code).toBe('INTERNAL');
  });
});
