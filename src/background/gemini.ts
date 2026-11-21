import type { ErrorCode, Variant } from '../shared/messages';

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
    // Model or endpoint missing — the router should fall back to another model,
    // so this must not surface as INVALID_KEY.
    return new GeminiError('NETWORK', `Model or endpoint not found: ${detail}`, retryAfterMs);
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

// ---------- Structured generation (P1.5) ----------

const DEFAULT_MODEL = 'gemini-2.0-flash';

const VARIANTS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    variants: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          text: { type: 'STRING' },
        },
        required: ['label', 'text'],
      },
    },
  },
  required: ['variants'],
} as const;

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

export interface GenerateVariantsOptions {
  key: string;
  model?: string;
  systemInstruction?: string;
  userPrompt: string;
  /** Maximum variants to return (default 3). */
  count?: number;
}

/**
 * Ask Gemini for rewrite variants as structured JSON, then parse,
 * validate, and deduplicate the result.
 */
export async function generateVariants(
  options: GenerateVariantsOptions,
): Promise<Variant[]> {
  const model = options.model ?? DEFAULT_MODEL;
  const body = {
    ...(options.systemInstruction
      ? { systemInstruction: { parts: [{ text: options.systemInstruction }] } }
      : {}),
    contents: [{ parts: [{ text: options.userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: VARIANTS_SCHEMA,
      temperature: 0.7,
    },
  };

  const res = await geminiFetch(`/models/${model}:generateContent`, options.key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as GenerateContentResponse;

  if (data.promptFeedback?.blockReason) {
    throw new GeminiError(
      'SAFETY_BLOCK',
      `Request blocked by safety filters (${data.promptFeedback.blockReason}).`,
    );
  }
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'SAFETY') {
    throw new GeminiError('SAFETY_BLOCK', 'Response blocked by safety filters.');
  }

  const raw = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GeminiError('BAD_OUTPUT', 'Gemini returned malformed JSON.', undefined);
  }

  return validateVariants(parsed, options.count ?? 3);
}

function validateVariants(parsed: unknown, count: number): Variant[] {
  const list =
    typeof parsed === 'object' && parsed !== null && 'variants' in parsed
      ? (parsed as { variants: unknown }).variants
      : parsed;
  if (!Array.isArray(list)) {
    throw new GeminiError('BAD_OUTPUT', 'Gemini output did not contain a variants array.');
  }

  const seen = new Set<string>();
  const variants: Variant[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const { label, text } = item as { label?: unknown; text?: unknown };
    if (typeof text !== 'string' || !text.trim()) continue;
    const key = text.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push({
      label: typeof label === 'string' && label.trim() ? label.trim() : `Option ${variants.length + 1}`,
      text: text.trim(),
    });
    if (variants.length >= count) break;
  }
  if (variants.length === 0) {
    throw new GeminiError('BAD_OUTPUT', 'Gemini returned no usable variants.');
  }
  return variants;
}
