/**
 * API client (TASK-006, TASK-077).
 *
 * fetch wrapper that sends the session cookie, serializes JSON or FormData,
 * and turns the server's error envelope into an ApiError.
 */

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: unknown,
    public readonly requestId: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const fields = (err.details as { fields?: Record<string, string[]> } | undefined)?.fields;
    if (err.code === 'VALIDATION_ERROR' && fields) {
      const first = Object.values(fields).flat()[0];
      if (first) return first;
    }
    return err.message || fallback;
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}

function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return '';
  const searchParams = new URLSearchParams();
  for (const [key, val] of Object.entries(query)) {
    if (val !== undefined && val !== null && val !== '') {
      searchParams.append(key, String(val));
    }
  }
  const str = searchParams.toString();
  return str ? `?${str}` : '';
}

const REQUEST_TIMEOUT_MS = 30_000; // plan Section 1.1: 30 s client timeout

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, unknown>,
): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const fullPath = `${path}${buildQuery(query)}`;
  const headers: Record<string, string> = {};
  if (!isFormData && body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(fullPath, {
      method,
      credentials: 'include',
      headers,
      body: isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', 'The request timed out.', undefined, '');
    }
    throw new ApiError(0, 'NETWORK', 'Could not reach the server.', undefined, '');
  }
  clearTimeout(timer);

  if (!res.ok) {
    let envelope: ErrorEnvelope | null = null;
    try {
      envelope = (await res.json()) as ErrorEnvelope;
    } catch {
      // Non-JSON error body
    }
    throw new ApiError(
      res.status,
      envelope?.error?.code ?? 'UNKNOWN',
      envelope?.error?.message ?? res.statusText,
      envelope?.error?.details,
      envelope?.error?.requestId ?? '',
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(path: string, query?: Record<string, unknown>) =>
    request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown, query?: Record<string, unknown>) =>
    request<T>('POST', path, body, query),
  patch: <T>(path: string, body?: unknown, query?: Record<string, unknown>) =>
    request<T>('PATCH', path, body, query),
  delete: <T>(path: string, body?: unknown, query?: Record<string, unknown>) =>
    request<T>('DELETE', path, body, query),
  upload: <T>(path: string, formData: FormData) => request<T>('POST', path, formData),
};

export const api = apiClient;
