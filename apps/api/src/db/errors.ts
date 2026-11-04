/**
 * apps/api/src/db/errors.ts (TASK-019)
 *
 * Maps PostgreSQL error codes to domain AppError instances:
 *   - 23505 (unique_violation) -> CONFLICT (409)
 *   - 23503 (foreign_key_violation) -> CONFLICT (409)
 *   - 23514 (check_violation) -> VALIDATION_ERROR (400)
 *   - 57014 (query_canceled / statement_timeout) -> UNAVAILABLE (503)
 */

import { AppError } from '../middleware/appError.js';

interface PgDatabaseError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
}

export function isPgError(err: unknown): err is PgDatabaseError {
  return err instanceof Error && 'code' in err && typeof (err as PgDatabaseError).code === 'string';
}

export function mapPgError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }

  if (isPgError(err)) {
    switch (err.code) {
      case '23505': // unique_violation
        return new AppError(
          409,
          'CONFLICT',
          err.detail || err.message || 'Resource conflict: duplicate value already exists',
          { constraint: err.constraint },
        );
      case '23503': // foreign_key_violation
        return new AppError(
          409,
          'CONFLICT',
          err.detail || err.message || 'Resource conflict: referenced entity not found or in use',
          { constraint: err.constraint },
        );
      case '23514': // check_violation
        return new AppError(
          400,
          'VALIDATION_ERROR',
          err.message || 'Validation error: constraint check failed',
          { constraint: err.constraint },
        );
      case '57014': // query_canceled / statement_timeout
        return new AppError(503, 'UNAVAILABLE', 'Database query timed out or was canceled');
      default:
        break;
    }
  }

  const message = err instanceof Error ? err.message : 'Database error';
  return new AppError(500, 'INTERNAL', message);
}
