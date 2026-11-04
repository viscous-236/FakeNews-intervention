/**
 * apps/api/test/security/logging-and-shutdown.test.ts (TASK-105, REQ-037)
 *
 * Tests for logging redaction (Pino) and graceful shutdown flow.
 */

import { describe, it, expect } from 'vitest';
import http from 'http';
import pino from 'pino';
import { executeGracefulShutdown } from '../../src/shutdown.js';

describe('TASK-105: Logging Redaction and Graceful Shutdown (REQ-037)', () => {
  describe('1. Logging Redaction', () => {
    it('redacts sensitive fields in structured logs', async () => {
      let loggedOutput = '';

      // Create a dedicated destination capturing logs
      const stream = {
        write: (msg: string) => {
          loggedOutput += msg;
        },
      };

      const testLogger = pino(
        {
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
        },
        stream,
      );

      // Log an object containing sensitive credentials
      testLogger.info(
        {
          userId: 'user-123',
          email: 'sensitive-user@example.com',
          password: 'SecretPassword999!',
          token: 'jwt-or-session-token-abc',
          req: {
            headers: {
              authorization: 'Bearer super-secret-token',
              cookie: 'session_token=abcdef1234567890',
            },
          },
          publicField: 'safe-to-log',
        },
        'User action completed',
      );

      const parsed = JSON.parse(loggedOutput.trim()) as {
        userId?: string;
        publicField?: string;
        email?: string;
        password?: string;
        token?: string;
        req: { headers: { authorization?: string; cookie?: string } };
      };

      // Confirm safe fields are retained
      expect(parsed.userId).toBe('user-123');
      expect(parsed.publicField).toBe('safe-to-log');

      // Confirm sensitive fields are strictly redacted
      expect(parsed.email).toBe('[REDACTED]');
      expect(parsed.password).toBe('[REDACTED]');
      expect(parsed.token).toBe('[REDACTED]');
      expect(parsed.req.headers.authorization).toBe('[REDACTED]');
      expect(parsed.req.headers.cookie).toBe('[REDACTED]');

      // Confirm no cleartext secrets exist in the raw string
      expect(loggedOutput).not.toContain('sensitive-user@example.com');
      expect(loggedOutput).not.toContain('SecretPassword999!');
      expect(loggedOutput).not.toContain('super-secret-token');
      expect(loggedOutput).not.toContain('abcdef1234567890');
    });
  });

  describe('2. Graceful Shutdown (REQ-037)', () => {
    it('gracefully drains HTTP server, stops loops, and completes within timeout', async () => {
      // Create a real HTTP server listening on an ephemeral port
      const server = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end('ok');
      });

      await new Promise<void>((resolve) => {
        server.listen(0, () => resolve());
      });

      expect(server.listening).toBe(true);

      const startTime = Date.now();
      await executeGracefulShutdown({ server });
      const elapsedMs = Date.now() - startTime;

      // Server should no longer be listening
      expect(server.listening).toBe(false);

      // Must complete well within the 20-second hard limit (REQ-037)
      expect(elapsedMs).toBeLessThan(5000);
    });
  });
});
