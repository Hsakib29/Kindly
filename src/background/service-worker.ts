import { generateVariants, listModels } from './gemini';
import { getKey, getSettings, setSettings } from '../shared/storage';
import { SYSTEM_PROMPT, buildRewritePrompt } from '../shared/prompts';
import type { ApiError, ExtensionRequest, ExtensionResponse } from '../shared/messages';

console.log('[Kindly] service worker started');

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
        const variants = await generateVariants({
          key,
          systemInstruction: SYSTEM_PROMPT,
          userPrompt: buildRewritePrompt({
            text: trimmed,
            tone: request.tone,
            instruction: request.instruction,
            avoid: request.avoid,
          }),
        });
        return { type: 'REWRITE_RESULT', requestId: request.requestId, variants };
      } catch (err) {
        const apiError = toApiError(err);
        console.error('[Kindly] REWRITE failed:', apiError.code, apiError.message);
        return {
          type: 'ERROR',
          requestId: request.requestId,
          error: apiError,
        };
      }
    }

    case 'WRITE':
      // Implemented in P1.5/P3.x and P6.x.
      return {
        type: 'ERROR',
        requestId: request.requestId,
        error: { code: 'NETWORK', message: 'Not implemented yet' },
      };
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
