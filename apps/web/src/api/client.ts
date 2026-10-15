/**
 * API client (TASK-006).
 *
 * Thin fetch wrapper that:
 *   - Always sends credentials (session cookie)
 *   - Parses the error envelope into an ApiError
 *   - Provides typed helpers for common methods
 */

/** Error envelope shape (Section 1.7) */
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Origin: window.location.origin,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

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

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};
