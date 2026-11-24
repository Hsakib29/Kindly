// Toolbar popup (P7.6): per-site on/off, today's usage, settings link.

import { getSettings, setSettings } from '../shared/storage';
import type { ExtensionResponse } from '../shared/messages';
import { PRODUCT_NAME } from '../shared/brand';
import { resolveTheme } from '../shared/theme';
import { normalizeHost } from '../shared/siteMatch';

const titleEl = document.getElementById('app-title') as HTMLElement;
const toggleEl = document.getElementById('site-toggle') as HTMLInputElement;
const siteNameEl = document.getElementById('site-name') as HTMLElement;
const usageEl = document.getElementById('usage') as HTMLElement;
const pageCtxEl = document.getElementById('page-context-site') as HTMLInputElement;
const pageCtxNote = document.getElementById('page-context-note') as HTMLElement;
const optionsLink = document.getElementById('open-options') as HTMLAnchorElement;

titleEl.textContent = PRODUCT_NAME;
optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  void chrome.runtime.openOptionsPage();
});

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function main() {
  const settings = await getSettings();
  document.documentElement.dataset.theme = resolveTheme(settings.theme ?? 'auto');
  const tabId = await activeTabId();

  // Ask the content script for this site's hostname + hidden state.
  let hostname = '';
  let hidden = false;
  if (tabId !== undefined) {
    try {
      const info = (await chrome.tabs.sendMessage(tabId, {
        type: 'GET_SITE_INFO',
      })) as { hostname?: string; hidden?: boolean } | undefined;
      hostname = normalizeHost(info?.hostname ?? '');
      hidden = info?.hidden ?? false;
    } catch {
      // Content script not running (e.g. chrome:// page) — disable toggle.
      toggleEl.disabled = true;
      siteNameEl.textContent = 'Kindly is off on this page';
    }
  }
  siteNameEl.textContent = hostname;
  toggleEl.checked = !hidden;

  // Per-site page-context checkbox (K-04): checked unless explicitly off.
  const globalOn = settings.pageContextEnabled ?? false;
  const map = settings.usePageContextBySite ?? {};
  pageCtxEl.checked = map[hostname] !== false;
  pageCtxEl.disabled = !globalOn || !hostname;
  pageCtxNote.hidden = globalOn;
  if (hostname) {
    pageCtxEl.addEventListener('change', async () => {
      const st = await getSettings();
      const next = { ...(st.usePageContextBySite ?? {}), [hostname]: pageCtxEl.checked };
      await setSettings({ usePageContextBySite: next });
    });
  }

  toggleEl.addEventListener('change', async () => {
    const settings = await getSettings();
    const hiddenSites = new Set(settings.hiddenSites);
    if (toggleEl.checked) hiddenSites.delete(hostname);
    else hiddenSites.add(hostname);
    await setSettings({ hiddenSites: [...hiddenSites] });
    // Content scripts pick the change up via storage.onChanged — no reload.
  });

  // Today's usage via the service worker.
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'GET_USAGE',
    })) as ExtensionResponse;
    if (res.type === 'USAGE') usageEl.textContent = `Rewrites today: ${res.count}`;
  } catch {
    usageEl.textContent = 'Rewrites today: —';
  }
}

void main();
