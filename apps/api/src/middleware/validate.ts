/**
 * apps/api/src/middleware/validate.ts (TASK-037, REQ-010, REQ-026, Section 1.7)
 *
 * Strict Zod request validator for params, query, and body. Before parsing,
 * every string in the request is NFC-normalized and rejected when it contains
 * control characters other than newline (REQ-026). Trimming is done by the
 * schemas themselves.
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from './errors.js';

export interface ValidationTargets {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

// C0 controls except LF (0x0A), plus DEL (0x7F) and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;

/**
 * Walks a decoded JSON value, normalizing strings to NFC and collecting the
 * paths of strings that carry control characters.
 */
export function normalizeText(value: unknown, path: string[] = [], bad: string[] = []): unknown {
  if (typeof value === 'string') {
    const normalized = value.normalize('NFC');
    if (CONTROL_CHARS.test(normalized)) bad.push(path.join('.') || 'root');
    return normalized;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => normalizeText(item, [...path, String(i)], bad));
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeText(v, [...path, k], bad);
    }
    return out;
  }
  return value;
}

function setRequestProperty(req: Request, key: 'params' | 'query', value: unknown): void {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

export function validate(schemas: ValidationTargets) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const bad: string[] = [];
      if (schemas.params) {
        const normalized = normalizeText(req.params, ['params'], bad);
        setRequestProperty(req, 'params', schemas.params.parse(normalized));
      }
      if (schemas.query) {
        const normalized = normalizeText(req.query, ['query'], bad);
        setRequestProperty(req, 'query', schemas.query.parse(normalized));
      }
      if (schemas.body) {
        const normalized = normalizeText(req.body, ['body'], bad);
        if (bad.length) {
          return next(
            new AppError(400, 'VALIDATION_ERROR', 'Validation failed', {
              fields: Object.fromEntries(
                bad.map((p) => [p, ['Control characters are not allowed']]),
              ),
            }),
          );
        }
        req.body = schemas.body.parse(normalized);
      }
      if (bad.length) {
        return next(
          new AppError(400, 'VALIDATION_ERROR', 'Validation failed', {
            fields: Object.fromEntries(bad.map((p) => [p, ['Control characters are not allowed']])),
          }),
        );
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const fields: Record<string, string[]> = {};
        for (const issue of err.issues) {
          if (
            issue.code === 'unrecognized_keys' &&
            Array.isArray((issue as unknown as { keys?: string[] }).keys)
          ) {
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
