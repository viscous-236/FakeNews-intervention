/**
 * apps/api/src/middleware/validate.ts (TASK-037, REQ-010, Section 1.7)
 *
 * Strict Zod request validator for params, query, and body.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from './errors.js';

export interface ValidationTargets {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validate(schemas: ValidationTargets) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        const parsedParams = schemas.params.parse(req.params);
        Object.defineProperty(req, 'params', {
          value: parsedParams,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      if (schemas.query) {
        const parsedQuery = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', {
          value: parsedQuery,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const fields: Record<string, string[]> = {};
        for (const issue of err.issues) {
          if (issue.code === 'unrecognized_keys' && Array.isArray((issue as unknown as { keys?: string[] }).keys)) {
            for (const key of (issue as unknown as { keys: string[] }).keys) {
              (fields[key] ??= []).push(issue.message);
            }
          } else {
            const path = issue.path.join('.') || 'root';
            (fields[path] ??= []).push(issue.message);
          }
        }
        return next(new AppError(400, 'VALIDATION_ERROR', 'Validation failed', { fields }));
      }
      next(err);
    }
  };
}
