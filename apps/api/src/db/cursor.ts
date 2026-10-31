/**
 * apps/api/src/db/cursor.ts (TASK-019, PAT-006)
 *
 * Keyset cursor pagination encoding and decoding.
 * Format: base64url of `<ISO 8601 created_at>|<uuid id>`
 */

import { AppError } from '../app.js';

export interface DecodedCursor {
  createdAt: Date;
  id: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Encode (createdAt, id) tuple into a base64url opaque cursor string.
 */
export function encodeCursor(createdAt: Date, id: string): string {
  const payload = `${createdAt.toISOString()}|${id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decode base64url cursor string back into (createdAt, id).
 * Throws AppError(400, 'VALIDATION_ERROR') on any malformed cursor.
 */
export function decodeCursor(cursor: string): DecodedCursor {
  if (typeof cursor !== 'string' || !cursor) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Cursor must be a non-empty string');
  }

  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid base64url cursor');
  }

  const parts = decoded.split('|');
  if (parts.length !== 2) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Malformed cursor format');
  }

  const [dateStr, id] = parts;
  if (!dateStr || !id) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Malformed cursor parts');
  }

  const createdAt = new Date(dateStr);
  if (Number.isNaN(createdAt.getTime())) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid date in cursor');
  }

  if (!UUID_REGEX.test(id)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid ID in cursor');
  }

  return { createdAt, id };
}
