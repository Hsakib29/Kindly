import type { ErrorCode } from '../shared/messages';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterMs?: number;

  constructor(code: ErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'GeminiError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

interface GoogleErrorBody {
  error?: { message?: string; status?: string; details?: { retryDelay?: string }[] };
}

/** Map an HTTP failure to a friendly error code (P1.6). */
export function mapHttpError(status: number, body: GoogleErrorBody): GeminiError {
  const detail = body.error?.message ?? `HTTP ${status}`;
  const retryDelay = body.error?.details?.find((d) => d.retryDelay)?.retryDelay;
  const retryAfterMs = retryDelay ? parseRetryDelay(retryDelay) : undefined;

  if (status === 400 || status === 401 || status === 403) {
    return new GeminiError('INVALID_KEY', detail, retryAfterMs);
  }
  if (status === 429) {
    return new GeminiError('RATE_LIMIT', detail, retryAfterMs);
  }
  if (status === 404) {
    return new GeminiError('INVALID_KEY', `Model or endpoint not found: ${detail}`);
  }
  if (status >= 500) {
    return new GeminiError('NETWORK', `Gemini server error: ${detail}`, retryAfterMs);
  }
  return new GeminiError('NETWORK', detail, retryAfterMs);
}

function parseRetryDelay(delay: string): number | undefined {
  // Google returns e.g. "30s" or "1.5s".
  const match = /([\d.]+)s/.exec(delay);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : undefined;
}

function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError; // fetch throws TypeError on network failure
}

async function geminiFetch(path: string, key: string, init?: RequestInit): Promise<Response> {
  const url = `${BASE_URL}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (isNetworkFailure(err)) {
      throw new GeminiError('NETWORK', 'Could not reach the Gemini API. Check your connection.');
    }
    throw err;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as GoogleErrorBody;
    throw mapHttpError(res.status, body);
  }
  return res;
}

/** List available models; returns the count (used by key verification). */
export async function listModels(key: string): Promise<number> {
  const res = await geminiFetch('/models?pageSize=1000', key);
  const data = (await res.json()) as { models?: unknown[] };
  return data.models?.length ?? 0;
}
