/**
 * apps/api/src/detection/client.ts (TASK-048, Section 1.6)
 *
 * Backend client for the Python detector HTTP service:
 *   - POST /v1/predict (header X-Detector-Key, validates schema, range, requestId matching)
 *   - GET  /healthz    (warm-up and readiness check)
 *   - GET  /v1/model-info (model metadata, metrics, thresholds)
 *
 * Error codes mapped:
 *   TIMEOUT, NETWORK, HTTP_401, HTTP_422, HTTP_5XX, MALFORMED_RESPONSE, REQUEST_ID_MISMATCH
 */

import { z } from 'zod';
import { type DetectorErrorCode } from '@app/shared';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const detectorPredictRequestSchema = z
  .object({
    request_id: z.string().uuid(),
    post_id: z.string().uuid(),
    text: z.string().min(1).max(2000),
  })
  .strict();

export type DetectorPredictRequest = z.infer<typeof detectorPredictRequestSchema>;

export const detectorPredictResponseSchema = z
  .object({
    request_id: z.string().uuid(),
    model_name: z.string().min(1),
    model_version: z.string().min(1),
    p_fake: z.number().min(0).max(1),
    latency_ms: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export type DetectorPredictResponse = z.infer<typeof detectorPredictResponseSchema>;

export const detectorHealthResponseSchema = z
  .object({
    status: z.string(),
    model_loaded: z.boolean(),
  })
  .passthrough();

export type DetectorHealthResponse = z.infer<typeof detectorHealthResponseSchema>;

export const detectorModelInfoResponseSchema = z
  .object({
    model_name: z.string().min(1),
    model_version: z.string().min(1),
    trained_at: z.string().optional(),
    dataset: z.string().optional(),
    dataset_sha256: z.string().optional(),
    label_mapping: z.record(z.unknown()).optional(),
    metrics: z.record(z.unknown()).optional(),
    recommended_thresholds: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type DetectorModelInfo = z.infer<typeof detectorModelInfoResponseSchema>;

export interface DetectorPrediction {
  requestId: string;
  modelName: string;
  modelVersion: string;
  pFake: number;
  latencyMs?: number;
}

// ---------------------------------------------------------------------------
// Error Class
// ---------------------------------------------------------------------------

export class DetectorClientError extends Error {
  public readonly errorCode: DetectorErrorCode;
  public readonly statusCode?: number;
  public readonly details?: unknown;

  constructor(
    errorCode: DetectorErrorCode,
    message: string,
    statusCode?: number,
    details?: unknown,
  ) {
    super(message);
    this.name = 'DetectorClientError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Client Functions
// ---------------------------------------------------------------------------

export interface PredictOptions {
  requestId: string;
  postId: string;
  text: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * Calls POST /v1/predict on the detector service.
 */
export async function predict(options: PredictOptions): Promise<DetectorPrediction> {
  const {
    requestId,
    postId,
    text,
    baseUrl = config.DETECTOR_URL,
    apiKey = config.DETECTOR_API_KEY,
    timeoutMs = config.DETECTOR_TIMEOUT_MS,
  } = options;

  const requestBody = detectorPredictRequestSchema.parse({
    request_id: requestId,
    post_id: postId,
    text,
  });

  const url = `${baseUrl.replace(/\/+$/, '')}/v1/predict`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Detector-Key': apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if ((err as { name?: string }).name === 'AbortError') {
      throw new DetectorClientError(
        'TIMEOUT',
        `Detector prediction timed out after ${timeoutMs}ms`,
      );
    }
    throw new DetectorClientError(
      'NETWORK',
      `Detector network error: ${(err as Error).message}`,
      undefined,
      err,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle HTTP error statuses
  if (!response.ok) {
    const status = response.status;
    let errBody: unknown;
    try {
      errBody = await response.json();
    } catch {
      errBody = await response.text().catch(() => null);
    }

    if (status === 401) {
      throw new DetectorClientError(
        'HTTP_401',
        'Detector unauthorized (invalid or missing X-Detector-Key)',
        401,
        errBody,
      );
    }
    if (status === 422) {
      throw new DetectorClientError(
        'HTTP_422',
        'Detector unprocessable input',
        422,
        errBody,
      );
    }
    if (status >= 500) {
      throw new DetectorClientError(
        'HTTP_5XX',
        `Detector server error (status ${status})`,
        status,
        errBody,
      );
    }
    // Any other 4xx status
    throw new DetectorClientError(
      'HTTP_5XX',
      `Detector returned unexpected status ${status}`,
      status,
      errBody,
    );
  }

  // Parse JSON body
  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (err: unknown) {
    throw new DetectorClientError(
      'MALFORMED_RESPONSE',
      `Detector response is not valid JSON: ${(err as Error).message}`,
      response.status,
    );
  }

  // Validate response shape and range
  const parseResult = detectorPredictResponseSchema.safeParse(rawJson);
  if (!parseResult.success) {
    throw new DetectorClientError(
      'MALFORMED_RESPONSE',
      `Detector response failed schema validation: ${parseResult.error.message}`,
      response.status,
      parseResult.error.format(),
    );
  }

  const data = parseResult.data;

  // Validate request_id matching
  if (data.request_id !== requestId) {
    throw new DetectorClientError(
      'REQUEST_ID_MISMATCH',
      `Detector returned request_id ${data.request_id}, expected ${requestId}`,
      response.status,
      { sent: requestId, received: data.request_id },
    );
  }

  return {
    requestId: data.request_id,
    modelName: data.model_name,
    modelVersion: data.model_version,
    pFake: data.p_fake,
    latencyMs: data.latency_ms,
  };
}

export interface CheckHealthOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Checks detector /healthz endpoint. Used for warm-up and readiness check.
 */
export async function checkDetectorHealth(
  options?: CheckHealthOptions,
): Promise<{ ok: boolean; modelLoaded: boolean }> {
  const baseUrl = options?.baseUrl ?? config.DETECTOR_URL;
  const timeoutMs = options?.timeoutMs ?? config.DETECTOR_WARMUP_TIMEOUT_MS;

  const url = `${baseUrl.replace(/\/+$/, '')}/healthz`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if ((err as { name?: string }).name === 'AbortError') {
      throw new DetectorClientError(
        'TIMEOUT',
        `Detector health check timed out after ${timeoutMs}ms`,
      );
    }
    throw new DetectorClientError(
      'NETWORK',
      `Detector health check failed: ${(err as Error).message}`,
      undefined,
      err,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return { ok: false, modelLoaded: false };
  }

  try {
    const json = await response.json();
    const parsed = detectorHealthResponseSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, modelLoaded: false };
    }
    return {
      ok: parsed.data.status === 'ok',
      modelLoaded: Boolean(parsed.data.model_loaded),
    };
  } catch {
    return { ok: false, modelLoaded: false };
  }
}

export interface ModelInfoOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * Calls GET /v1/model-info to retrieve model metadata.
 */
export async function getDetectorModelInfo(
  options?: ModelInfoOptions,
): Promise<DetectorModelInfo> {
  const baseUrl = options?.baseUrl ?? config.DETECTOR_URL;
  const apiKey = options?.apiKey ?? config.DETECTOR_API_KEY;
  const timeoutMs = options?.timeoutMs ?? config.DETECTOR_TIMEOUT_MS;

  const url = `${baseUrl.replace(/\/+$/, '')}/v1/model-info`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Detector-Key': apiKey,
      },
      signal: controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if ((err as { name?: string }).name === 'AbortError') {
      throw new DetectorClientError(
        'TIMEOUT',
        `Detector model-info timed out after ${timeoutMs}ms`,
      );
    }
    throw new DetectorClientError(
      'NETWORK',
      `Detector model-info network error: ${(err as Error).message}`,
      undefined,
      err,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401) {
    throw new DetectorClientError(
      'HTTP_401',
      'Detector unauthorized on model-info',
      401,
    );
  }
  if (!response.ok) {
    throw new DetectorClientError(
      'HTTP_5XX',
      `Detector model-info returned status ${response.status}`,
      response.status,
    );
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (err: unknown) {
    throw new DetectorClientError(
      'MALFORMED_RESPONSE',
      `Detector model-info response is not valid JSON: ${(err as Error).message}`,
      response.status,
    );
  }

  const parsed = detectorModelInfoResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new DetectorClientError(
      'MALFORMED_RESPONSE',
      `Detector model-info failed validation: ${parsed.error.message}`,
      response.status,
    );
  }

  return parsed.data;
}
