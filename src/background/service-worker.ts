import { listModels } from './gemini';
import { getSettings, setSettings } from '../shared/storage';
import type { ApiError, ExtensionRequest, ExtensionResponse } from '../shared/messages';

declare const __GEMINI_API_KEY__: string;

console.log('[Kindly] service worker started');

const GEMINI_MODEL = 'gemini-2.0-flash';

async function callGeminiSpike(): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const res = await fetch(`${url}?key=${__GEMINI_API_KEY__}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Reply with exactly: Kindly is alive.' }] }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '(empty response)';
}

// P0.4 spike: fire one test call on startup when a key is configured.
if (__GEMINI_API_KEY__) {
  callGeminiSpike()
    .then((text) => console.log('[Kindly] Gemini response:', text))
    .catch((err) => console.error('[Kindly] Gemini call failed:', err));
} else {
  console.log('[Kindly] No key.txt found — skipping Gemini spike call.');
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

    case 'REWRITE':
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
