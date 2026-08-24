const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
export const API_BASE_URL = configuredBaseUrl || 'http://localhost:3000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiOptions = Omit<RequestInit, 'body'> & { body?: unknown };

function extractApiMessage(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    return 'Something went wrong. Please try again.';
  }

  const message = (payload as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim()) {
    return message;
  }
  if (Array.isArray(message)) {
    const messages = message.filter(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
    if (messages.length > 0) {
      return messages.join(' ');
    }
  }

  return 'Something went wrong. Please try again.';
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    body,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : undefined;

  if (!response.ok) {
    const message = extractApiMessage(payload);
    const requestId =
      typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as { requestId?: unknown }).requestId === 'string'
        ? (payload as { requestId: string }).requestId
        : undefined;
    throw new ApiError(message, response.status, requestId);
  }

  return payload as T;
}
