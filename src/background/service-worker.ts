console.log('[Kindly] service worker started');

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse({ type: 'pong' });
  }
  return false;
});
