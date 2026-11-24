import { listModels, generateVariants } from './gemini';
import { generateRouted, isModelCooling, availableModels, pickEscalationModel } from './router';
import { checkVariants } from './quality';
import type { ContextBriefData, Variant } from '../shared/messages';
import { getSettings, setSettings, getStoredKey, setStoredKey, isEncryptedKey } from '../shared/storage';
import {
  decryptWithKey,
  deriveSessionKey,
  encryptSecret,
  exportKeyJwk,
  importKeyJwk,
} from '../shared/crypto';
import {
  ROLE_LABELS,
  TASK_SYSTEM_PROMPT,
  buildTaskPrompt,
} from '../shared/prompts';
import type { ApiError, ExtensionRequest, ExtensionResponse } from '../shared/messages';
import { debugEnabled, debugGroup, debugGroupEnd, debugLog, setDebugEnabled } from '../shared/debug';
import { sanitizeBrief } from '../shared/privacy';
import { effectiveNeverRunSites, hostBlocked, normalizeHost } from '../shared/siteMatch';

/**
 * Final privacy boundary before prompt construction: sanitize any
 * context brief (structured or legacy string) so no request path can
 * send raw webpage text to Gemini. Counts are logged debug-only.
 */
function sanitizeRequestContext(
  brief: ContextBriefData | undefined,
  legacyContext: string | undefined,
): ContextBriefData | undefined {
  let out = brief;
  if (!out && legacyContext) {
    out = { platform: 'web', contextText: legacyContext };
  }
  if (!out) return undefined;
  const { brief: clean, total, counts } = sanitizeBrief(out);
  if (total > 0 && debugEnabled()) {
    debugLog('privacy: redacted', total, 'item(s)', JSON.stringify(counts));
  }
  return clean;
}

debugLog('service worker started');

// In-flight REWRITE abort controllers, keyed by requestId, so the panel
// can cancel a running request by closing (CANCEL message).
const pendingRequests = new Map<string, AbortController>();

// Daily rewrite counter for the toolbar popup (P7.6).
// K-22: local-date day key + serialized read-modify-write so
// concurrent requests can't lose counts.
function usageDayKey(d = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

let usageQueue: Promise<void> = Promise.resolve();

async function bumpUsage() {
  usageQueue = usageQueue.then(async () => {
    const day = usageDayKey();
    const { usage } = (await chrome.storage.local.get('usage')) as {
      usage?: { day: string; count: number };
    };
    const count = usage?.day === day ? usage.count + 1 : 1;
    await chrome.storage.local.set({ usage: { day, count } });
  });
  return usageQueue;
}

// Stronger models tried once when quality checks still fail on a lite model.
interface QualityPassArgs {
  key: string;
  model: string;
  systemInstruction: string;
  userPrompt: string;
  signal?: AbortSignal;
  /** K-21: overall request deadline (Date.now() ms). */
  deadlineAt?: number;
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
    checkVariants(vs, { draft: args.draft, brief: args.brief, mode: args.mode });

  let best = label(args.variants);
  let bestFailures = check(best).failures;
  let bestModel = args.model;
  let extraRequests = 0;

  if (bestFailures.length === 0) {
    return { variants: best, model: bestModel, extraRequests };
  }
  if (debugEnabled()) debugLog('quality checks failed:', bestFailures.join('; '));

  // K-07: a cancelled request must not trigger retry/escalation calls.
  if (args.signal?.aborted || (args.deadlineAt && Date.now() > args.deadlineAt)) {
    return { variants: best, model: bestModel, extraRequests };
  }

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
  if (args.signal?.aborted || (args.deadlineAt && Date.now() > args.deadlineAt)) {
    return { variants: best, model: bestModel, extraRequests };
  }
  if (bestFailures.length > 0 && /lite/i.test(args.model)) {
    // K-26: escalate to the first model the key can actually use.
    const catalog = await availableModels(args.key);
    const m = pickEscalationModel(catalog, isModelCooling);
    if (m) {
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
    }
  }

  if (debugEnabled() && bestFailures.length > 0) {
    debugLog('quality checks still failing after retries:', bestFailures.join('; '));
  }
  return { variants: best, model: bestModel, extraRequests };
}

// ---------- Key resolution (P8.7: optional passphrase encryption) ----------

// chrome.storage.session serializes as JSON — a CryptoKey does not
// survive that, so the session cache stores the exported JWK instead.
const SESSION_KEY_NAME = 'kindlySessionKeyJwk';

async function getSessionKey(): Promise<CryptoKey | null> {
  const stored = (await chrome.storage.session.get(SESSION_KEY_NAME)) as {
    [SESSION_KEY_NAME]?: JsonWebKey;
  };
  const jwk = stored[SESSION_KEY_NAME];
  if (!jwk || typeof jwk !== 'object' || !('k' in jwk)) {
    if (jwk !== undefined) await chrome.storage.session.remove(SESSION_KEY_NAME);
    return null;
  }
  try {
    return await importKeyJwk(jwk);
  } catch {
    await chrome.storage.session.remove(SESSION_KEY_NAME);
    return null;
  }
}

async function setSessionKey(key: CryptoKey | null) {
  if (key) {
    await chrome.storage.session.set({ [SESSION_KEY_NAME]: await exportKeyJwk(key) });
  } else {
    await chrome.storage.session.remove(SESSION_KEY_NAME);
  }
}

/** Returns the usable API key, or null when locked/absent. */
async function resolveApiKey(): Promise<{ key: string | null; locked: boolean }> {
  const stored = await getStoredKey();
  if (!stored) return { key: null, locked: false };
  if (typeof stored === 'string') return { key: stored, locked: false };
  const sessionKey = await getSessionKey();
  if (!sessionKey) return { key: null, locked: true };
  try {
    return { key: await decryptWithKey(stored, sessionKey), locked: false };
  } catch {
    await setSessionKey(null);
    return { key: null, locked: true };
  }
}

async function keyState() {
  const stored = await getStoredKey();
  const protectedKey = isEncryptedKey(stored);
  const unlocked = protectedKey ? (await getSessionKey()) !== null : true;
  return { type: 'KEY_STATE' as const, protected: protectedKey, unlocked };
}

function toApiError(err: unknown): ApiError {
  if (err instanceof Error && 'code' in err) {
    const e = err as { code: ApiError['code']; message: string; retryAfterMs?: number };
    return { code: e.code, message: e.message, retryAfterMs: e.retryAfterMs };
  }
  return { code: 'NETWORK', message: err instanceof Error ? err.message : String(err) };
}

async function handle(request: ExtensionRequest, sender?: chrome.runtime.MessageSender): Promise<ExtensionResponse> {
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

    case 'GET_USAGE': {
      const { usage } = (await chrome.storage.local.get('usage')) as {
        usage?: { day: string; count: number };
      };
      const day = usageDayKey();
      return {
        type: 'USAGE',
        day,
        count: usage?.day === day ? usage.count : 0,
      };
    }

    case 'GET_KEY_STATE':
      return keyState();

    case 'ENCRYPT_KEY': {
      const stored = await getStoredKey();
      if (isEncryptedKey(stored)) {
        return {
          type: 'ERROR',
          error: { code: 'INVALID_KEY', message: 'Key is already encrypted.' },
        };
      }
      if (typeof stored !== 'string' || !stored) {
        return {
          type: 'ERROR',
          error: { code: 'NO_KEY', message: 'No API key to encrypt.' },
        };
      }
      const blob = await encryptSecret(stored, request.passphrase);
      await setStoredKey(blob);
      await setSessionKey(null);
      return keyState();
    }

    case 'UNLOCK_KEY': {
      const stored = await getStoredKey();
      if (!isEncryptedKey(stored)) return keyState();
      try {
        const sessionKey = await deriveSessionKey(stored, request.passphrase);
        await setSessionKey(sessionKey);
        return keyState();
      } catch {
        return {
          type: 'ERROR',
          error: { code: 'INVALID_KEY', message: 'Wrong passphrase.' },
        };
      }
    }

    case 'LOCK_KEY':
      await setSessionKey(null);
      return keyState();

    case 'REWRITE': {
      // K-08: register the cancel controller BEFORE any await so a CANCEL
      // arriving during resolveApiKey/getSettings is never dropped.
      const controller = new AbortController();
      pendingRequests.set(request.requestId, controller);
      const cancelled = () =>
        ({
          type: 'ERROR',
          requestId: request.requestId,
          error: { code: 'NETWORK' as const, message: 'Request cancelled.' },
        }) satisfies ExtensionResponse;
      try {
      if (await senderBlocked(sender)) {
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: { code: 'SITE_BLOCKED', message: 'Kindly is turned off on this site.' },
        };
      }
      const { key, locked } = await resolveApiKey();
      if (controller.signal.aborted) return cancelled();
      if (locked) {
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: {
            code: 'KEY_LOCKED',
            message: 'API key is locked — unlock it in Settings.',
          },
        };
      }
      if (!key) {
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: { code: 'NO_KEY', message: 'No API key configured.' },
        };
      }
      const trimmed = request.text.trim();
      if (trimmed.length === 0) {
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: { code: 'TEXT_TOO_SHORT', message: 'Nothing to rewrite.' },
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
        if (controller.signal.aborted) return cancelled();
        setDebugEnabled(settings.debug);
        // Privacy boundary (defense in depth): the content side already
        // sanitizes, but NO request may reach the prompt builder with raw
        // webpage context — sanitize here regardless of source.
        const brief = sanitizeRequestContext(request.brief, request.context);
        const built = buildTaskPrompt({
          draft: trimmed,
          tone: request.tone,
          instruction: request.instruction,
          avoid: request.avoid,
          brief,
          customToneInstruction: request.customToneInstruction,
          brandVoice: settings.brandVoice,
        });
        const userPrompt = built.userPrompt;
        const deadlineAt = Date.now() + 45_000;
        const t0 = performance.now();
        const { variants, model, fellBack, attempts } = await generateRouted({
          key,
          routerPreference: settings.routerPreference,
          signal: controller.signal,
          deadlineAt,
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
          deadlineAt,
          systemInstruction: TASK_SYSTEM_PROMPT,
          userPrompt,
          signal: controller.signal,
          mode: built.mode,
          draft: trimmed,
          brief,
          variants,
        });
        await bumpUsage(); // K-22: count only successful results
        return {
          type: 'REWRITE_RESULT',
          requestId: request.requestId,
          variants: quality.variants,
          model: quality.model,
          mode: built.mode,
        };
      } catch (err) {
        const apiError = toApiError(err);
        debugLog('REWRITE failed:', apiError.code, apiError.message);
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: apiError,
        };
      } finally {
        pendingRequests.delete(request.requestId);
      }
      } finally {
        pendingRequests.delete(request.requestId);
      }
    }

    case 'WRITE': {
      const controller = new AbortController();
      pendingRequests.set(request.requestId, controller);
      const cancelled = () =>
        ({
          type: 'ERROR',
          requestId: request.requestId,
          error: { code: 'NETWORK' as const, message: 'Request cancelled.' },
        }) satisfies ExtensionResponse;
      try {
      if (await senderBlocked(sender)) {
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: { code: 'SITE_BLOCKED', message: 'Kindly is turned off on this site.' },
        };
      }
      const { key, locked } = await resolveApiKey();
      if (controller.signal.aborted) return cancelled();
      if (locked) {
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: {
            code: 'KEY_LOCKED',
            message: 'API key is locked — unlock it in Settings.',
          },
        };
      }
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
        if (controller.signal.aborted) return cancelled();
        setDebugEnabled(settings.debug);
        const brief = sanitizeRequestContext(request.brief, request.context);
        const built = buildTaskPrompt({
          draft: prompt,
          isWrite: true,
          reviseDraft: request.draft,
          tone: request.tone,
          length: request.length,
          instruction: request.instruction,
          brief,
          customToneInstruction: request.customToneInstruction,
          brandVoice: settings.brandVoice,
          savedReply: request.savedReply,
        });
        const userPrompt = built.userPrompt;
        const deadlineAt = Date.now() + 45_000;
        const t0 = performance.now();
        const { variants, model, fellBack, attempts } = await generateRouted({
          key,
          routerPreference: settings.routerPreference,
          signal: controller.signal,
          deadlineAt,
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
          deadlineAt,
          systemInstruction: TASK_SYSTEM_PROMPT,
          userPrompt,
          signal: controller.signal,
          mode: built.mode,
          draft: request.draft ?? prompt,
          brief,
          variants,
        });
        await bumpUsage(); // K-22: count only successful results
        return {
          type: 'WRITE_RESULT',
          requestId: request.requestId,
          variants: quality.variants,
          model: quality.model,
          mode: built.mode,
        };
      } catch (err) {
        const apiError = toApiError(err);
        debugLog('WRITE failed:', apiError.code, apiError.message);
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: apiError,
        };
      } finally {
        pendingRequests.delete(request.requestId);
      }
      } finally {
        pendingRequests.delete(request.requestId);
      }
    }

    default:
      // GET_SITE_INFO is answered by the content script, not the SW.
      return { type: 'PONG' };
  }
}

/** Defense in depth: refuse generation from blocked sites (sender frame URL). */
async function senderBlocked(sender: chrome.runtime.MessageSender | undefined): Promise<boolean> {
  if (!sender) return true; // deny by default
  const url = sender.tab?.url ?? sender.url;
  if (!url) return true; // deny by default
  let host = '';
  try {
    host = normalizeHost(new URL(url).hostname);
  } catch {
    return false;
  }
  const settings = await getSettings();
  return (
    hostBlocked(settings.hiddenSites ?? [], host) ||
    hostBlocked(effectiveNeverRunSites(settings.neverRunSites ?? []), host)
  );
}

// K-18: key/settings mutations are extension-pages-only. Content
// scripts (sender.tab set) can read state but never change it.
const EXTENSION_ONLY = new Set([
  'ENCRYPT_KEY',
  'UNLOCK_KEY',
  'LOCK_KEY',
  'VERIFY_KEY',
  'SET_SETTINGS',
]);

chrome.runtime.onMessage.addListener((message: ExtensionRequest, sender, sendResponse) => {
  const notAllowed = {
    type: 'ERROR',
    error: { code: 'NOT_ALLOWED' as const, message: 'Message not allowed.' },
  } satisfies ExtensionResponse;
  if (sender.id !== chrome.runtime.id) {
    sendResponse(notAllowed);
    return false;
  }
  if (EXTENSION_ONLY.has((message as { type?: string }).type ?? '') && sender.tab) {
    sendResponse(notAllowed);
    return false;
  }
  handle(message, sender)
    .then(sendResponse)
    .catch((err) =>
      sendResponse({
        type: 'ERROR',
        error: toApiError(err),
      } satisfies ExtensionResponse),
    );
  return true; // async response
});

// First-run onboarding (P7.7): open the wizard on install.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  void (async () => {
    const { onboarded } = (await chrome.storage.local.get('onboarded')) as {
      onboarded?: boolean;
    };
    if (!onboarded) {
      await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    }
  })();
});
