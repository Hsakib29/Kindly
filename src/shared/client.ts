import type { ExtensionRequest, ExtensionResponse } from './messages';

/** Send a typed request to the service worker and await the typed response. */
export function sendRequest<T extends ExtensionResponse>(
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
