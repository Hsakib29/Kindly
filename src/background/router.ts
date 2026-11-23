// Model router (P5.1/P5.3): picks an ordered candidate list from the
// user's available models based on routerPreference, and cools down
// models that return RATE_LIMIT so subsequent requests skip them.

import {
  GeminiError,
  generateVariants,
  listModelIds,
  MODEL_FALLBACK_ORDER,
  type GenerateVariantsOptions,
} from './gemini';
import type { Settings, Variant } from '../shared/messages';

type RouterPreference = Settings['routerPreference'];

// Per-service-worker-worker cooldowns: model -> epoch ms when it may be retried.
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 60_000;

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
let catalogCache: { key: string; ids: string[] } | null = null;

async function availableModels(key: string): Promise<string[] | null> {
  if (catalogCache?.key === key) return catalogCache.ids;
  try {
    const ids = await listModelIds(key);
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
}

/**
 * generateVariants through the router: skips cooling models, cools down
 * models that hit RATE_LIMIT, retries NETWORK failures once per model,
 * then moves to the next candidate.
 */
export async function generateRouted(
  options: GenerateVariantsOptions & { routerPreference?: RouterPreference },
): Promise<RoutedResult> {
  const order = await buildOrder(options.key, options.routerPreference ?? 'auto');
  const candidates = order.filter((m) => !isCooling(m));
  if (candidates.length === 0) {
    // Everything is cooling — wait for the soonest one rather than failing.
    const soonest = Math.min(...[...cooldowns.values()].filter((t) => t > Date.now()));
    const wait = Math.max(soonest - Date.now(), 1000);
    await new Promise((r) => setTimeout(r, wait));
    candidates.push(...order.filter((m) => !isCooling(m)));
  }

  let lastError: GeminiError | null = null;
  for (const model of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const variants = await generateVariants({ ...options, model });
        return { variants, model, fellBack: model !== candidates[0] };
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
