/**
 * Pino logger (REQ-020).
 * Redacts passwords, tokens, cookies and authorization headers so they
 * never appear in structured logs.
 */

import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'currentPassword',
      'newPassword',
      'token',
      'tokenHash',
      'cookie',
      'authorization',
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'email',
    ],
    censor: '[REDACTED]',
  },
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});
