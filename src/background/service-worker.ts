declare const __GEMINI_API_KEY__: string;

console.log('[Kindly] service worker started');

const GEMINI_MODEL = 'gemini-2.0-flash';

async function callGemini(): Promise<string> {
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
  callGemini()
    .then((text) => console.log('[Kindly] Gemini response:', text))
    .catch((err) => console.error('[Kindly] Gemini call failed:', err));
} else {
  console.log('[Kindly] No key.txt found — skipping Gemini spike call.');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse({ type: 'pong' });
    return false;
  }
  if (message?.type === 'spike:gemini') {
    callGemini()
      .then((text) => sendResponse({ ok: true, text }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async response
  }
  return false;
});
