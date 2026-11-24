// Model router (P5.1/P5.3): picks an ordered candidate list from the
// user's available models based on routerPreference, and cools down
// models that return RATE_LIMIT so subsequent requests skip them.

import {
  GeminiError,
  generateVariants,
  listModelInfo,
  isTextGenerationModel,
  ESCALATION_MODELS,
  MODEL_FALLBACK_ORDER,
  type GenerateVariantsOptions,
} from './gemini';
import type { Settings, Variant } from '../shared/messages';

type RouterPreference = Settings['routerPreference'];

// Per-service-worker-worker cooldowns: model -> epoch ms when it may be retried.
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 60_000;

export function isModelCooling(model: string): boolean {
  return isCooling(model);
}

function isCooling(model: string): boolean {
  return (cooldowns.get(model) ?? 0) > Date.now();
}

function coolDown(model: string, retryAfterMs?: number) {
  cooldowns.set(model, Date.now() + (retryAfterMs ?? COOLDOWN_MS));
}

// P5.1: classify a model id into a speed tier.
function tierOf(model: string): 'fast' | 'balanced' | 'quality' {
  if (/lite/i.test(model)) return 'fast';
  if (/pro|ultra|thinking/i.test(model)) return 'quality';
  return 'balanced';
}

// Catalog cache: one /models fetch per service worker lifetime per key.
// K-16: only text-generation models are routable — embedding/TTS/image
// models can never be tried for a chat request.
let catalogCache: { key: string; ids: string[] } | null = null;

export async function availableModels(key: string): Promise<string[] | null> {
  if (catalogCache?.key === key) return catalogCache.ids;
  try {
    const infos = await listModelInfo(key);
    const ids = infos.filter(isTextGenerationModel).map((m) => m.id);
    catalogCache = { key, ids };
    return ids;
  } catch {
    return null; // fall back to the static list
  }
}

/**
 * Build the ordered candidate list for a request.
 * 'auto' keeps the tuned default order (lite-first for cost/speed);
 * 'speed' puts fast-tier models first; 'quality' puts quality-tier first.
 * Only models the key can actually use are kept (when the catalog loads).
 */
async function buildOrder(
  key: string,
  preference: RouterPreference,
): Promise<string[]> {
  const available = await availableModels(key);
  const pool = MODEL_FALLBACK_ORDER.filter((m) => !available || available.includes(m));
  // Append any usable catalog models not in the static list, tier-sorted.
  const extras = (available ?? []).filter((m) => !pool.includes(m));

  if (preference === 'auto') return [...pool, ...extras];

  const rank = (m: string) =>
    preference === 'speed'
      ? tierOf(m) === 'fast'
        ? 0
        : tierOf(m) === 'balanced'
          ? 1
          : 2
      : tierOf(m) === 'quality'
        ? 0
        : tierOf(m) === 'balanced'
          ? 1
          : 2;
  return [...pool, ...extras].sort((a, b) => rank(a) - rank(b));
}

export interface RoutedResult {
  variants: Variant[];
  model: string;
  fellBack: boolean;
  /** Models attempted, in order (for debug logging). */
  attempts: string[];
}

/**
 * generateVariants through the router: skips cooling models, cools down
 * models that hit RATE_LIMIT, retries NETWORK failures once per model,
 * then moves to the next candidate.
 */
/** K-26: first escalation model the key can use and isn't cooling. */
export function pickEscalationModel(
  catalog: string[] | null,
  cooling: (m: string) => boolean,
): string | undefined {
  return ESCALATION_MODELS.find((m) => (!catalog || catalog.includes(m)) && !cooling(m));
}

export async function generateRouted(
  options: GenerateVariantsOptions & { routerPreference?: RouterPreference },
): Promise<RoutedResult> {
  const order = await buildOrder(options.key, options.routerPreference ?? 'auto');
  if (options.deadlineAt && Date.now() > options.deadlineAt) {
    throw new GeminiError('TIMEOUT', 'Request took too long. Try again.');
  }
  const candidates = order.filter((m) => !isCooling(m));
  if (candidates.length === 0) {
    // K-21: empty candidate list is an error, not an Infinity wait.
    if (order.length === 0) {
      throw new GeminiError('NETWORK', 'No text model is available for this key right now.');
    }
    // Everything is cooling — wait for the soonest one rather than failing.
    const soonest = Math.min(...[...cooldowns.values()].filter((t) => t > Date.now()));
    const remaining = options.deadlineAt ? options.deadlineAt - Date.now() : Infinity;
    if (remaining <= 0) {
      throw new GeminiError('TIMEOUT', 'Request took too long. Try again.');
    }
    const wait = Math.min(Math.max(soonest - Date.now(), 1000), remaining);
    await new Promise((r) => setTimeout(r, wait));
    candidates.push(...order.filter((m) => !isCooling(m)));
    if (candidates.length === 0) {
      throw new GeminiError('NETWORK', 'No text model is available for this key right now.');
    }
  }

  const attempts: string[] = [];
  let lastError: GeminiError | null = null;
  for (const model of candidates) {
    // K-21: stop starting attempts once the overall deadline has passed.
    if (options.deadlineAt && Date.now() > options.deadlineAt) {
      throw new GeminiError('TIMEOUT', 'Request took too long. Try again.');
    }
    attempts.push(model);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const variants = await generateVariants({ ...options, model });
        return { variants, model, fellBack: model !== candidates[0], attempts };
      } catch (err) {
        const apiErr =
          err instanceof GeminiError
            ? err
            : new GeminiError('NETWORK', err instanceof Error ? err.message : String(err));
        lastError = apiErr;
        if (options.signal?.aborted) throw apiErr; // user cancelled — stop routing
        if (apiErr.code === 'RATE_LIMIT') {
          coolDown(model, apiErr.retryAfterMs);
          break; // next model immediately
        }
        // TIMEOUT and NETWORK are transient: retry once, then next model.
        if ((apiErr.code === 'NETWORK' || apiErr.code === 'TIMEOUT') && attempt === 0) continue;
        break;
      }
    }
  }
  throw lastError ?? new GeminiError('NETWORK', 'All models failed.');
}
