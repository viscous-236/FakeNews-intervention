/**
 * API client (TASK-006, TASK-077).
 *
 * Full-featured fetch wrapper that:
 *   - Sends credentials (session cookie)
 *   - Injects Origin header
 *   - Serializes JSON and handles FormData
 *   - Parses the backend error envelope into an ApiError
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

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, unknown>,
): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const fullPath = `${path}${buildQuery(query)}`;

  const headers: Record<string, string> = {
    Origin: typeof window !== 'undefined' ? window.location.origin : '',
  };

  if (!isFormData && body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(fullPath, {
    method,
    credentials: 'include',
    headers,
    body: isFormData ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
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
  get: <T>(path: string, query?: Record<string, unknown>) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown, query?: Record<string, unknown>) => request<T>('POST', path, body, query),
  patch: <T>(path: string, body?: unknown, query?: Record<string, unknown>) => request<T>('PATCH', path, body, query),
  delete: <T>(path: string, body?: unknown, query?: Record<string, unknown>) => request<T>('DELETE', path, body, query),
  upload: <T>(path: string, formData: FormData) => request<T>('POST', path, formData),
};

export const api = apiClient;
