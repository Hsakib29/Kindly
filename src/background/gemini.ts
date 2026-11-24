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

  // K-15: 400 is a rejected request (bad field, oversized prompt), not a
  // key problem — surface it as BAD_OUTPUT so the UI offers Retry instead
  // of sending the user to Settings.
  if (status === 400) {
    return new GeminiError(
      'BAD_OUTPUT',
      `Google rejected the request. Try again, or try a shorter text. (${detail})`,
      retryAfterMs,
    );
  }
  if (status === 401 || status === 403) {
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
  // K-19: key goes in the x-goog-api-key header, not the URL — keeps it
  // out of network logs, error reports and proxy logs.
  const url = `${BASE_URL}${path}`;
  const headers = new Headers(init?.headers);
  headers.set('x-goog-api-key', key);
  const mergedInit: RequestInit = { ...init, headers };
  let res: Response;
  try {
    res = await fetch(url, mergedInit);
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

export interface ModelInfo {
  id: string;
  methods: string[];
}

/** K-16: only models that can generate text for chat completions. */
export function isTextGenerationModel(info: { id: string; methods: string[] }): boolean {
  return (
    info.methods.includes('generateContent') &&
    !/embed|tts|image|imagen|veo|aqa|audio|live/i.test(info.id)
  );
}

/** List models with their supported generation methods (K-16). */
export async function listModelInfo(key: string): Promise<ModelInfo[]> {
  const res = await geminiFetch('/models?pageSize=1000', key);
  const data = (await res.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  return (data.models ?? [])
    .map((m) => ({
      id: m.name?.replace(/^models\//, '') ?? '',
      methods: m.supportedGenerationMethods ?? [],
    }))
    .filter((m) => m.id);
}

/** List available models; returns the count (used by key verification). */
export async function listModelIds(key: string): Promise<string[]> {
  const res = await geminiFetch('/models?pageSize=1000', key);
  const data = (await res.json()) as { models?: { name?: string }[] };
  return (data.models ?? [])
    .map((m) => m.name?.replace(/^models\//, '') ?? '')
    .filter(Boolean);
}

export async function listModels(key: string): Promise<number> {
  const res = await geminiFetch('/models?pageSize=1000', key);
  const data = (await res.json()) as { models?: unknown[] };
  return data.models?.length ?? 0;
}

// ---------- Structured generation (P1.5) ----------

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

// Ordered fallback list — lite first for speed/cost, bigger flash models
// behind it for quality and resilience. Updated from the live /models
// list; Stage 5 (P5.1) replaces this with a configurable map.
export const MODEL_FALLBACK_ORDER = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
];

const VARIANTS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    understanding: { type: 'STRING' },
    variants: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          role: { type: 'STRING' },
          label: { type: 'STRING' },
          text: { type: 'STRING' },
        },
        required: ['text'],
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
  /** External abort signal (e.g. user cancelled by closing the panel). */
  signal?: AbortSignal;
  /** Sampling temperature (default 0.5 — tuned for small models). */
  temperature?: number;
}

const REQUEST_TIMEOUT_MS = 25_000;

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
      temperature: options.temperature ?? 0.5,
    },
  };

  // K-07: already-cancelled requests must not reach Google — the abort
  // event fired before our listener was attached and won't fire again.
  if (options.signal?.aborted) {
    throw new GeminiError('NETWORK', 'Request cancelled.');
  }
  // Per-attempt timeout (25s) linked to the caller's abort signal.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  let res: Response;
  try {
    res = await geminiFetch(`/models/${model}:generateContent`, options.key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw options.signal?.aborted
        ? new GeminiError('NETWORK', 'Request cancelled.')
        : new GeminiError('TIMEOUT', 'Request timed out.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
    const { label, text, role } = item as {
      label?: unknown;
      text?: unknown;
      role?: unknown;
    };
    if (typeof text !== 'string' || !text.trim()) continue;
    const key = text.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push({
      label: typeof label === 'string' && label.trim() ? label.trim() : `Option ${variants.length + 1}`,
      text: text.trim(),
      role: typeof role === 'string' ? role.trim() : undefined,
    });
    if (variants.length >= count) break;
  }
  if (variants.length === 0) {
    throw new GeminiError('BAD_OUTPUT', 'Gemini returned no usable variants.');
  }
  return variants;
}

/**
 * generateVariants with model fallback: on RATE_LIMIT move to the next
 * model immediately; on NETWORK (5xx/overload) retry once, then move on.
 * INVALID_KEY / SAFETY_BLOCK / BAD_OUTPUT do not fall back.
 */
export async function generateVariantsWithFallback(
  options: GenerateVariantsOptions,
): Promise<{ variants: Variant[]; model: string; fellBack: boolean }> {
  const order = options.model
    ? [options.model, ...MODEL_FALLBACK_ORDER.filter((m) => m !== options.model)]
    : MODEL_FALLBACK_ORDER;

  let lastError: GeminiError | null = null;
  for (const model of order) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const variants = await generateVariants({ ...options, model });
        return { variants, model, fellBack: model !== order[0] };
      } catch (err) {
        const apiErr =
          err instanceof GeminiError
            ? err
            : new GeminiError('NETWORK', err instanceof Error ? err.message : String(err));
        lastError = apiErr;
        if (apiErr.code === 'RATE_LIMIT') break; // next model immediately
        if (apiErr.code === 'NETWORK' && attempt === 0) continue; // retry once, then next model
        break; // other errors, or second NETWORK failure — no more retries here
      }
    }
  }
  throw lastError ?? new GeminiError('NETWORK', 'All models failed.');
}
