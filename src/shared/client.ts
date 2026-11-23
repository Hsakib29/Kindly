import type { ExtensionRequest, ExtensionResponse } from './messages';

const RETRYABLE = /message port|receiving end|worker.*(asleep|restart|not running)|no receiving/i;

function sendOnce<T extends ExtensionResponse>(
  request: ExtensionRequest,
): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    chrome.runtime.sendMessage(request, (response: ExtensionResponse | undefined) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from service worker'));
        return;
      }
      resolvePromise(response as T);
    });
  });
}

/**
 * Send a typed request to the service worker and await the typed response.
 * MV3 service workers can be asleep when a message arrives — retry once
 * transparently on transient port errors. "Extension context invalidated"
 * is NOT retried (the page must reload).
 */
export function sendRequest<T extends ExtensionResponse>(
  request: ExtensionRequest,
): Promise<T> {
  return sendOnce<T>(request).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (RETRYABLE.test(msg) && !/invalidated/i.test(msg)) {
      return new Promise<T>((resolve, reject) =>
        setTimeout(() => sendOnce<T>(request).then(resolve, reject), 400),
      );
    }
    throw err;
  });
}
