export class ApiError extends Error {
  constructor(message, { status = 0, kind = 'request' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
  }
}

const TIMEOUT_MS = 25000;

function kindForStatus(status) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 429) return 'busy';
  if (status >= 500) return 'server';
  return 'request';
}

function fallbackMessage(status) {
  if (status === 401) return 'Please sign in to continue.';
  if (status === 403) return 'This account does not have access to that.';
  if (status === 404) return 'That item could not be found.';
  if (status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (status >= 500) return 'The studio system had a problem. Please try again.';
  return 'Something went wrong. Please try again.';
}

/**
 * Same-origin JSON fetch with the HttpOnly session cookie and a bounded wait.
 * The server remains the source of truth for every price and permission.
 */
export async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);
  const { headers, signal, ...requestOptions } = options;
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      ...requestOptions,
      headers: { 'Content-Type': 'application/json', ...(headers || {}) },
      signal: signal || controller.signal,
    });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const message = (data && data.error) || fallbackMessage(response.status);
      throw new ApiError(message, {
        status: response.status,
        kind: kindForStatus(response.status),
      });
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError' || error === 'timeout') {
      throw new ApiError('That took longer than expected. Check your connection and try again.', {
        kind: 'timeout',
      });
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ApiError("You're offline. Reconnect and try again.", { kind: 'offline' });
    }
    throw new ApiError('We could not reach the studio system. Check your connection and try again.', {
      kind: 'network',
    });
  } finally {
    clearTimeout(timeout);
  }
}
