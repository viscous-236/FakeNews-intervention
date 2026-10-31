/**
 * apps/api/src/middleware/security.ts (TASK-037, SEC-005)
 *
 * Helmet CSP & security header configuration.
 */

import { RequestHandler } from 'express';
import helmet from 'helmet';
import { config } from '../config.js';

function getS3Origin(): string {
  try {
    return new URL(config.S3_PUBLIC_BASE_URL).origin;
  } catch {
    return 'http://localhost:9000';
  }
}

export function securityMiddleware(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', getS3Origin()],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts:
      config.NODE_ENV === 'production'
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,
  });
}
