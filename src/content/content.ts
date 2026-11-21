console.log('[Kindly] content script loaded');

chrome.runtime.sendMessage({ type: 'ping' }, (response) => {
  if (chrome.runtime.lastError) {
    console.warn('[Kindly] ping failed:', chrome.runtime.lastError.message);
    return;
  }
  console.log('[Kindly] received:', response);
});
