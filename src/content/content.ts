import './spike';
import { getDeepActiveElement, isSupportedField } from './fields';
import { KindlyIcon } from './icon';
import { TypingTrigger } from './typing-trigger';
import { setSettings } from '../shared/storage';
import { sendRequest } from '../shared/client';
import { RewritePanel } from './panel';
import type { ExtensionResponse } from '../shared/messages';

type SettingsResponse = Extract<ExtensionResponse, { type: 'SETTINGS' }>;

console.log('[Kindly] content script loaded');

// P0.3 plumbing check (legacy ping shape kept for the spike).
chrome.runtime.sendMessage({ type: 'ping' }, (response) => {
  if (chrome.runtime.lastError) {
    console.warn('[Kindly] ping failed:', chrome.runtime.lastError.message);
    return;
  }
  console.log('[Kindly] received:', response);
});

const hostname = window.location.hostname;
let hiddenSites = new Set<string>();

async function refreshHiddenSites() {
  const res = await sendRequest<SettingsResponse>({ type: 'GET_SETTINGS' });
  if (res.type === 'SETTINGS') {
    hiddenSites = new Set(res.settings.hiddenSites);
  }
}
void refreshHiddenSites();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    const s = changes.settings.newValue as { hiddenSites?: string[] } | undefined;
    hiddenSites = new Set(s?.hiddenSites ?? []);
  }
});

function siteIsHidden(): boolean {
  return hiddenSites.has(hostname) || hiddenSites.has(window.location.host);
}

// ---------- Icon + typing orchestration (P2.3–P2.6) ----------

const BLUR_GRACE_MS = 250;
let blurTimer: number | undefined;
let currentField: HTMLElement | null = null;

const panel = new RewritePanel({
  onTone: () => {
    // P3.3 uses the selected tone for rewrite requests.
  },
  onUse: () => {
    // P3.5 wires insertion.
  },
  onRegenerate: () => {
    // P3.7 wires regeneration.
  },
  onInstruction: () => {
    // P3.8 wires the extra instruction.
  },
});

const icon = new KindlyIcon(
  () => {
    if (!currentField) return;
    const field = currentField;
    panel.open({
      getRect: () => field.getBoundingClientRect(),
      onClose: () => field.focus(),
    });
  },
  () => {
    if (!confirm(`Hide Kindly on ${hostname}? You can re-enable it in settings.`)) return;
    void setSettings({ hiddenSites: [...hiddenSites, hostname] }).then(() => {
      hiddenSites.add(hostname);
      icon.hide();
    });
  },
);

const trigger = new TypingTrigger(({ field, state }) => {
  if (state === 'ready' || state === 'ready-empty') {
    if (!siteIsHidden()) icon.show(field, state === 'ready-empty');
  } else if (state === 'typing') {
    icon.hide();
  }
  // 'idle' is handled by the blur grace timer below.
});

function fieldFromEvent(event: Event): HTMLElement | null {
  // composedPath pierces shadow roots so fields inside them are seen (P2.6).
  const target = (event.composedPath?.()[0] ?? event.target) as Element | null;
  return isSupportedField(target) ? target : null;
}

document.addEventListener('focusin', (event) => {
  window.clearTimeout(blurTimer);
  const field = fieldFromEvent(event);
  if (!field || siteIsHidden()) {
    currentField = null;
    icon.hide();
    return;
  }
  currentField = field;
  trigger.noteFocus(field);
});

document.addEventListener('focusout', (event) => {
  const field = fieldFromEvent(event);
  if (field) trigger.noteBlur(field);
  // Grace period so clicking the icon doesn't hide it (P2.5).
  blurTimer = window.setTimeout(() => {
    const active = getDeepActiveElement();
    if (!active || !isSupportedField(active) || active !== currentField) {
      currentField = null;
      icon.hide();
    }
  }, BLUR_GRACE_MS);
});

// `input` is composed, so it crosses shadow boundaries.
document.addEventListener('input', (event) => {
  const field = fieldFromEvent(event);
  if (field) trigger.noteInput(field);
});
