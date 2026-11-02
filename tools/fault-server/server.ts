/** Test-only fault-injecting HTTP server (TASK-052). */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export type FaultMode = 'timeout' | 'network-error' | 'http-401' | 'http-422' | 'http-500' | 'malformed' | 'mismatch';

export interface FaultServerOptions {
  mode: FaultMode;
  port?: number;
  delayMs?: number;
}

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(body));
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: FaultServerOptions,
): void {
  if (request.method === 'GET' && request.url === '/healthz') {
    json(response, 200, { status: 'ok', model_loaded: true });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/predict') {
    json(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    return;
  }

  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk: string) => { body += chunk; });
  request.on('end', () => {
    if (options.mode === 'timeout') {
      setTimeout(() => response.destroy(), options.delayMs ?? 60_000);
      return;
    }
    if (options.mode === 'network-error') {
      response.destroy(new Error('Injected network failure'));
      return;
    }
    if (options.mode === 'http-401') {
      json(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Injected unauthorized' } });
      return;
    }
    if (options.mode === 'http-422') {
      json(response, 422, { error: { code: 'INVALID_INPUT', message: 'Injected invalid input' } });
      return;
    }
    if (options.mode === 'http-500') {
      json(response, 500, { error: { code: 'INFERENCE_ERROR', message: 'Injected failure' } });
      return;
    }
    if (options.mode === 'malformed') {
      response.statusCode = 200;
      response.end('{malformed');
      return;
    }

    let requestId = '11111111-1111-1111-1111-111111111111';
    try {
      requestId = JSON.parse(body).request_id ?? requestId;
    } catch {
      json(response, 422, { error: { code: 'INVALID_INPUT', message: 'Invalid JSON' } });
      return;
    }
    if (options.mode === 'mismatch') requestId = '00000000-0000-0000-0000-000000000000';
    json(response, 200, {
      request_id: requestId,
      model_name: 'fault-server',
      model_version: 'fault-server-1',
      p_fake: 0.5,
      latency_ms: 1,
    });
  });
}

export function createFaultServer(options: FaultServerOptions): Server {
  return createServer((request, response) => handleRequest(request, response, options));
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  const mode = process.env.FAULT_MODE as FaultMode | undefined;
  if (!mode) throw new Error('FAULT_MODE is required');
  const port = Number(process.env.PORT ?? 8010);
  createFaultServer({ mode, port }).listen(port, '127.0.0.1');
}
