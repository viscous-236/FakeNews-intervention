/**
 * apps/api/src/middleware/appError.ts (TASK-037, REQ-011)
 *
 * Base AppError and ErrorEnvelope types without any circular dependencies.
 */

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
