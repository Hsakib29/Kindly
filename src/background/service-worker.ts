import { listModels, generateVariants } from './gemini';
import { generateRouted, isModelCooling } from './router';
import { checkVariants } from './quality';
import type { ContextBriefData, Variant } from '../shared/messages';
import { getKey, getSettings, setSettings } from '../shared/storage';
import {
  ROLE_LABELS,
  TASK_SYSTEM_PROMPT,
  buildTaskPrompt,
} from '../shared/prompts';
import type { ApiError, ExtensionRequest, ExtensionResponse } from '../shared/messages';
import { debugEnabled, debugGroup, debugGroupEnd, debugLog, setDebugEnabled } from '../shared/debug';

console.log('[Kindly] service worker started');

// In-flight REWRITE abort controllers, keyed by requestId, so the panel
// can cancel a running request by closing (CANCEL message).
const pendingRequests = new Map<string, AbortController>();

// Stronger models tried once when quality checks still fail on a lite model.
const ESCALATION_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'];

interface QualityPassArgs {
  key: string;
  model: string;
  systemInstruction: string;
  userPrompt: string;
  signal?: AbortSignal;
  mode: 'expand' | 'polish';
  draft: string;
  brief?: ContextBriefData;
  variants: Variant[];
}

/**
 * Q4: run code checks on the variants; on failure retry once on the same
 * model with a stricter instruction, then escalate once to a stronger
 * non-cooling model. Returns the best result found (fewest failures).
 */
async function applyQualityChecks(args: QualityPassArgs): Promise<{
  variants: Variant[];
  model: string;
  extraRequests: number;
}> {
  const label = (vs: Variant[]) =>
    vs.map((v) => ({ ...v, label: ROLE_LABELS[args.mode][v.role ?? ''] ?? v.label }));
  const check = (vs: Variant[]) =>
    checkVariants(vs, { draft: args.draft, brief: args.brief });

  let best = label(args.variants);
  let bestFailures = check(best).failures;
  let bestModel = args.model;
  let extraRequests = 0;

  if (bestFailures.length === 0) {
    return { variants: best, model: bestModel, extraRequests };
  }
  if (debugEnabled()) debugLog('quality checks failed:', bestFailures.join('; '));

  // Retry once on the same model with the failures named.
  try {
    extraRequests++;
    const stricter =
      args.userPrompt +
      `\n\nYour previous attempt failed these checks: ${bestFailures.join('; ')}. ` +
      'Produce variants that pass ALL of them.';
    const retry = await generateVariants({
      key: args.key,
      model: args.model,
      systemInstruction: args.systemInstruction,
      userPrompt: stricter,
      signal: args.signal,
    });
    const cand = label(retry);
    const candFailures = check(cand).failures;
    if (candFailures.length < bestFailures.length) {
      best = cand;
      bestFailures = candFailures;
      bestModel = `${args.model} (retry)`;
    }
  } catch {
    /* retry failed — keep best so far */
  }

  // Escalate once to a stronger model if checks still fail and we were lite.
  if (bestFailures.length > 0 && /lite/i.test(args.model)) {
    for (const m of ESCALATION_MODELS) {
      if (isModelCooling(m)) continue;
      try {
        extraRequests++;
        const esc = await generateVariants({
          key: args.key,
          model: m,
          systemInstruction: args.systemInstruction,
          userPrompt: args.userPrompt,
          signal: args.signal,
        });
        const cand = label(esc);
        const candFailures = check(cand).failures;
        if (candFailures.length < bestFailures.length) {
          best = cand;
          bestFailures = candFailures;
          bestModel = m;
        }
      } catch {
        /* escalation failed — keep best so far */
      }
      break; // at most one escalation attempt
    }
  }

  if (debugEnabled() && bestFailures.length > 0) {
    debugLog('quality checks still failing after retries:', bestFailures.join('; '));
  }
  return { variants: best, model: bestModel, extraRequests };
}

function toApiError(err: unknown): ApiError {
  if (err instanceof Error && 'code' in err) {
    const e = err as { code: ApiError['code']; message: string; retryAfterMs?: number };
    return { code: e.code, message: e.message, retryAfterMs: e.retryAfterMs };
  }
  return { code: 'NETWORK', message: err instanceof Error ? err.message : String(err) };
}

async function handle(request: ExtensionRequest): Promise<ExtensionResponse> {
  switch (request.type) {
    case 'PING':
      return { type: 'PONG' };

    case 'VERIFY_KEY': {
      try {
        const modelCount = await listModels(request.key);
        return { type: 'VERIFY_KEY_RESULT', ok: true, modelCount };
      } catch (err) {
        return { type: 'VERIFY_KEY_RESULT', ok: false, error: toApiError(err) };
      }
    }

    case 'GET_SETTINGS':
      return { type: 'SETTINGS', settings: await getSettings() };

    case 'SET_SETTINGS':
      return { type: 'SETTINGS', settings: await setSettings(request.patch) };

    case 'OPEN_OPTIONS':
      // openOptionsPage isn't callable from content scripts; do it here.
      await chrome.runtime.openOptionsPage();
      return { type: 'PONG' };

    case 'CANCEL':
      pendingRequests.get(request.requestId)?.abort();
      return { type: 'PONG' };

    case 'REWRITE': {
      const key = await getKey();
      if (!key) {
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: { code: 'NO_KEY', message: 'No API key configured.' },
        };
      }
      const trimmed = request.text.trim();
      if (trimmed.length < 15) {
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: { code: 'TEXT_TOO_SHORT', message: 'Text is too short to rewrite.' },
        };
      }
      if (trimmed.length > 8000) {
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: { code: 'TEXT_TOO_LONG', message: 'Text is too long to rewrite.' },
        };
      }
      try {
        const settings = await getSettings();
        setDebugEnabled(settings.debug);
        // Legacy string context becomes a brief fallback.
        const brief =
          request.brief ??
          (request.context ? { platform: 'web', contextText: request.context } : undefined);
        const built = buildTaskPrompt({
          draft: trimmed,
          tone: request.tone,
          instruction: request.instruction,
          avoid: request.avoid,
          brief,
        });
        const userPrompt = built.userPrompt;
        const controller = new AbortController();
        pendingRequests.set(request.requestId, controller);
        const t0 = performance.now();
        const { variants, model, fellBack, attempts } = await generateRouted({
          key,
          routerPreference: settings.routerPreference,
          signal: controller.signal,
          systemInstruction: TASK_SYSTEM_PROMPT,
          userPrompt,
        });
        const ms = Math.round(performance.now() - t0);
        if (debugEnabled()) {
          debugGroup(`REWRITE (${request.tone})`);
          debugLog('task: rewrite | tone:', request.tone);
          debugLog('model:', model, '| fellBack:', fellBack, '| attempts:', attempts.join(' → '));
          debugLog('instruction:', request.instruction ? 'yes' : 'no');
          debugLog('mode:', built.mode);
          debugLog('context:', request.brief || request.context ? 'yes' : 'none');
          if (request.brief) {
            debugLog('brief:', JSON.stringify({ ...request.brief, replyTarget: undefined, contextText: undefined }));
          }
          debugLog('prompt:\n' + userPrompt);
          debugLog(`response: ${variants.length} variants in ${ms}ms`);
          debugGroupEnd();
        }
        const quality = await applyQualityChecks({
          key,
          model,
          systemInstruction: TASK_SYSTEM_PROMPT,
          userPrompt,
          signal: controller.signal,
          mode: built.mode,
          draft: trimmed,
          brief,
          variants,
        });
        return {
          type: 'REWRITE_RESULT',
          requestId: request.requestId,
          variants: quality.variants,
          model: quality.model,
        };
      } catch (err) {
        const apiError = toApiError(err);
        console.error('[Kindly] REWRITE failed:', apiError.code, apiError.message);
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: apiError,
        };
      } finally {
        pendingRequests.delete(request.requestId);
      }
    }

    case 'WRITE': {
      const key = await getKey();
      if (!key) {
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: { code: 'NO_KEY', message: 'No API key configured.' },
        };
      }
      const prompt = request.prompt.trim();
      if (prompt.length === 0) {
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: { code: 'TEXT_TOO_SHORT', message: 'Describe what to write first.' },
        };
      }
      if (prompt.length > 2000) {
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: { code: 'TEXT_TOO_LONG', message: 'Prompt is too long (max ~2000 characters).' },
        };
      }
      try {
        const settings = await getSettings();
        setDebugEnabled(settings.debug);
        const brief =
          request.brief ??
          (request.context ? { platform: 'web', contextText: request.context } : undefined);
        const built = buildTaskPrompt({
          draft: prompt,
          isWrite: true,
          reviseDraft: request.draft,
          tone: request.tone,
          length: request.length,
          instruction: request.instruction,
          brief,
        });
        const userPrompt = built.userPrompt;
        const controller = new AbortController();
        pendingRequests.set(request.requestId, controller);
        const t0 = performance.now();
        const { variants, model, fellBack, attempts } = await generateRouted({
          key,
          routerPreference: settings.routerPreference,
          signal: controller.signal,
          systemInstruction: TASK_SYSTEM_PROMPT,
          userPrompt,
        });
        const ms = Math.round(performance.now() - t0);
        if (debugEnabled()) {
          debugGroup('WRITE');
          debugLog('task: write | tone:', request.tone ?? 'none', '| length:', request.length ?? 'any');
          debugLog('model:', model, '| fellBack:', fellBack, '| attempts:', attempts.join(' → '));
          debugLog('instruction:', request.instruction ? 'yes' : 'no', '| draft:', request.draft ? 'yes' : 'no');
          debugLog('context:', request.context ? `${request.context.length} chars` : 'none');
          debugLog('prompt:\n' + userPrompt);
          debugLog(`response: ${variants.length} variants in ${ms}ms`);
          debugGroupEnd();
        }
        const quality = await applyQualityChecks({
          key,
          model,
          systemInstruction: TASK_SYSTEM_PROMPT,
          userPrompt,
          signal: controller.signal,
          mode: built.mode,
          draft: request.draft ?? prompt,
          brief,
          variants,
        });
        return {
          type: 'WRITE_RESULT',
          requestId: request.requestId,
          variants: quality.variants,
          model: quality.model,
        };
      } catch (err) {
        const apiError = toApiError(err);
        console.error('[Kindly] WRITE failed:', apiError.code, apiError.message);
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: apiError,
        };
      } finally {
        pendingRequests.delete(request.requestId);
      }
    }
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionRequest, _sender, sendResponse) => {
  handle(message)
    .then(sendResponse)
    .catch((err) =>
      sendResponse({
        type: 'ERROR',
        error: toApiError(err),
      } satisfies ExtensionResponse),
    );
  return true; // async response
});
