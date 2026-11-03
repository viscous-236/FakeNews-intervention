/**
 * apps/api/test/detection/client.test.ts (TASK-048, Section 1.6)
 *
 * Unit tests for detector client error codes and contract compliance:
 *   - Success response parsing
 *   - Error code mapping:
 *       - HTTP_401
 *       - HTTP_422
 *       - HTTP_5XX
 *       - TIMEOUT
 *       - NETWORK
 *       - MALFORMED_RESPONSE
 *       - REQUEST_ID_MISMATCH
 *   - checkDetectorHealth (200 ok vs 503 not loaded)
 *   - getDetectorModelInfo (metadata retrieval and auth failure)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import crypto from 'crypto';
import {
  predict,
  checkDetectorHealth,
  getDetectorModelInfo,
} from '../../src/detection/client.js';

describe('Detector Client (TASK-048, Section 1.6)', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastHeaders: http.IncomingHttpHeaders = {};
  let lastBody: unknown = null;

  // Handlers for specific test scenarios
  let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      lastHeaders = req.headers;
      let bodyData = '';
      req.on('data', (chunk) => {
        bodyData += chunk;
      });
      req.on('end', () => {
        try {
          lastBody = bodyData ? JSON.parse(bodyData) : null;
        } catch {
          lastBody = bodyData;
        }
        if (handler) {
          handler(req, res);
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const testApiKey = 'secret_test_detector_key';

  it('times out stalled response bodies for predict, health, and model-info', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{');
      // Deliberately never finish the response; the client must abort it.
    };
    const calls = [
      () => predict({ requestId: crypto.randomUUID(), postId: crypto.randomUUID(),
        text: 'A claim for a stalled response', baseUrl, timeoutMs: 100 }),
      () => checkDetectorHealth({ baseUrl, timeoutMs: 100 }),
      () => getDetectorModelInfo({ baseUrl, timeoutMs: 100 }),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ errorCode: 'TIMEOUT' });
  });

  // -------------------------------------------------------------------------
  // Success Case
  // -------------------------------------------------------------------------
  it('parses valid predict response and passes correct headers', async () => {
    const requestId = crypto.randomUUID();
    const postId = crypto.randomUUID();

    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          request_id: requestId,
          model_name: 'tfidf_lr',
          model_version: 'tfidf_lr-v1',
          p_fake: 0.8421,
          latency_ms: 12,
        }),
      );
    };

    const result = await predict({
      requestId,
      postId,
      text: 'Sample text to predict',
      baseUrl,
      apiKey: testApiKey,
    });

    expect(lastHeaders['x-detector-key']).toBe(testApiKey);
    expect(lastHeaders['content-type']).toBe('application/json');
    const parsedBody = lastBody as Record<string, unknown>;
    expect(parsedBody.request_id).toBe(requestId);
    expect(parsedBody.post_id).toBe(postId);
    expect(parsedBody.text).toBe('Sample text to predict');

    expect(result.requestId).toBe(requestId);
    expect(result.modelName).toBe('tfidf_lr');
    expect(result.modelVersion).toBe('tfidf_lr-v1');
    expect(result.pFake).toBe(0.8421);
    expect(result.latencyMs).toBe(12);
  });

  // -------------------------------------------------------------------------
  // Error Code: HTTP_401
  // -------------------------------------------------------------------------
  it('maps 401 response to HTTP_401 error code', async () => {
    const requestId = crypto.randomUUID();
    handler = (_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Bad key' } }));
    };

    await expect(
      predict({
        requestId,
        postId: crypto.randomUUID(),
        text: 'Text',
        baseUrl,
        apiKey: 'wrong_key',
      }),
    ).rejects.toMatchObject({
      errorCode: 'HTTP_401',
      statusCode: 401,
    });
  });

  // -------------------------------------------------------------------------
  // Error Code: HTTP_422
  // -------------------------------------------------------------------------
  it('maps 422 response to HTTP_422 error code', async () => {
    const requestId = crypto.randomUUID();
    handler = (_req, res) => {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'Too short' } }));
    };

    await expect(
      predict({
        requestId,
        postId: crypto.randomUUID(),
        text: 'Text',
        baseUrl,
        apiKey: testApiKey,
      }),
    ).rejects.toMatchObject({
      errorCode: 'HTTP_422',
      statusCode: 422,
    });
  });

  // -------------------------------------------------------------------------
  // Error Code: HTTP_5XX
  // -------------------------------------------------------------------------
  it('maps 500/503 response to HTTP_5XX error code', async () => {
    const requestId = crypto.randomUUID();
    handler = (_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'MODEL_NOT_READY' } }));
    };

    await expect(
      predict({
        requestId,
        postId: crypto.randomUUID(),
        text: 'Text',
        baseUrl,
        apiKey: testApiKey,
      }),
    ).rejects.toMatchObject({
      errorCode: 'HTTP_5XX',
      statusCode: 503,
    });
  });

  // -------------------------------------------------------------------------
  // Error Code: TIMEOUT
  // -------------------------------------------------------------------------
  it('maps abort/timeout to TIMEOUT error code', async () => {
    const requestId = crypto.randomUUID();
    handler = () => {
      // Intentionally do not respond, simulating hung process
    };

    await expect(
      predict({
        requestId,
        postId: crypto.randomUUID(),
        text: 'Text',
        baseUrl,
        apiKey: testApiKey,
        timeoutMs: 50, // 50ms short timeout
      }),
    ).rejects.toThrowError(
      expect.objectContaining({
        errorCode: 'TIMEOUT',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Error Code: NETWORK
  // -------------------------------------------------------------------------
  it('maps connection refused to NETWORK error code', async () => {
    const requestId = crypto.randomUUID();
    // Connect to unused port
    await expect(
      predict({
        requestId,
        postId: crypto.randomUUID(),
        text: 'Text',
        baseUrl: 'http://127.0.0.1:59999',
        apiKey: testApiKey,
        timeoutMs: 500,
      }),
    ).rejects.toMatchObject({
      errorCode: 'NETWORK',
    });
  });

  // -------------------------------------------------------------------------
  // Error Code: MALFORMED_RESPONSE (Non-JSON or invalid range)
  // -------------------------------------------------------------------------
  it('maps non-JSON response to MALFORMED_RESPONSE', async () => {
    const requestId = crypto.randomUUID();
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error HTML or plain text');
    };

    await expect(
      predict({
        requestId,
        postId: crypto.randomUUID(),
        text: 'Text',
        baseUrl,
        apiKey: testApiKey,
      }),
    ).rejects.toMatchObject({
      errorCode: 'MALFORMED_RESPONSE',
    });
  });

  it('maps out-of-range p_fake (> 1.0) to MALFORMED_RESPONSE', async () => {
    const requestId = crypto.randomUUID();
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          request_id: requestId,
          model_name: 'test_model',
          model_version: 'v1',
          p_fake: 1.5, // Invalid > 1
        }),
      );
    };

    await expect(
      predict({
        requestId,
        postId: crypto.randomUUID(),
        text: 'Text',
        baseUrl,
        apiKey: testApiKey,
      }),
    ).rejects.toMatchObject({
      errorCode: 'MALFORMED_RESPONSE',
    });
  });

  // -------------------------------------------------------------------------
  // Error Code: REQUEST_ID_MISMATCH
  // -------------------------------------------------------------------------
  it('maps mismatched request_id to REQUEST_ID_MISMATCH error code', async () => {
    const requestId = crypto.randomUUID();
    const wrongRequestId = crypto.randomUUID();

    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          request_id: wrongRequestId,
          model_name: 'test_model',
          model_version: 'v1',
          p_fake: 0.5,
        }),
      );
    };

    await expect(
      predict({
        requestId,
        postId: crypto.randomUUID(),
        text: 'Text',
        baseUrl,
        apiKey: testApiKey,
      }),
    ).rejects.toMatchObject({
      errorCode: 'REQUEST_ID_MISMATCH',
    });
  });

  // -------------------------------------------------------------------------
  // Health Check: checkDetectorHealth
  // -------------------------------------------------------------------------
  describe('checkDetectorHealth', () => {
    it('returns { ok: true, modelLoaded: true } when /healthz is 200 loaded', async () => {
      handler = (req, res) => {
        expect(req.url).toBe('/healthz');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', model_loaded: true }));
      };

      const result = await checkDetectorHealth({ baseUrl });
      expect(result.ok).toBe(true);
      expect(result.modelLoaded).toBe(true);
    });

    it('returns { ok: false, modelLoaded: false } when /healthz returns 503', async () => {
      handler = (_req, res) => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'loading', model_loaded: false }));
      };

      const result = await checkDetectorHealth({ baseUrl });
      expect(result.ok).toBe(false);
      expect(result.modelLoaded).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Model Info: getDetectorModelInfo
  // -------------------------------------------------------------------------
  describe('getDetectorModelInfo', () => {
    it('returns parsed model metadata on 200', async () => {
      handler = (req, res) => {
        expect(req.url).toBe('/v1/model-info');
        expect(req.headers['x-detector-key']).toBe(testApiKey);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            model_name: 'distilroberta',
            model_version: 'distilroberta-abc12345',
            trained_at: '2026-10-31T00:00:00Z',
            dataset: 'ucsbnlp/liar',
            metrics: { val_macro_f1: 0.65 },
          }),
        );
      };

      const info = await getDetectorModelInfo({ baseUrl, apiKey: testApiKey });
      expect(info.model_name).toBe('distilroberta');
      expect(info.model_version).toBe('distilroberta-abc12345');
      expect(info.metrics).toBeDefined();
    });

    it('throws HTTP_401 on unauthorized model info request', async () => {
      handler = (_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }));
      };

      await expect(
        getDetectorModelInfo({ baseUrl, apiKey: 'bad_key' }),
      ).rejects.toMatchObject({
        errorCode: 'HTTP_401',
      });
    });
  });
});
