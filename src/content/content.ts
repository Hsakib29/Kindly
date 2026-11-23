import './spike';
import { getDeepActiveElement, isSupportedField } from './fields';
import {
  getFieldSelection,
  insertText,
  readFieldText,
  type FieldSelection,
} from './inserter';
import { UndoToast } from './toast';
import { KindlyIcon } from './icon';
import { TypingTrigger } from './typing-trigger';
import { setSettings } from '../shared/storage';
import { sendRequest } from '../shared/client';
import { RewritePanel } from './panel';
import type { ApiError, ExtensionResponse, ToneId, Variant } from '../shared/messages';

type ErrorResponse = Extract<ExtensionResponse, { type: 'ERROR' }>;

type SettingsResponse = Extract<ExtensionResponse, { type: 'SETTINGS' }>;

console.log('[Kindly] content script loaded');

// P0.3 plumbing check.
chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
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

let selectedTone: ToneId = 'professional';
let lastVariants: Variant[] = [];
let lastInstruction = '';
const recentInstructions: string[] = [];
let pendingSelection: FieldSelection | undefined;
let rewriteInFlight = false;
// Latest-wins queue: chip clicks while a request is in flight are queued,
// not dropped or parallel-fired.
let queuedRewrite: { tone: ToneId; instruction?: string; avoid?: string[] } | null = null;

async function requestRewrite(tone: ToneId, instruction?: string, avoid?: string[]) {
  if (rewriteInFlight) {
    queuedRewrite = { tone, instruction, avoid };
    return;
  }
  const field = currentField;
  if (!field) return;

  // P3.9: a non-empty selection is rewritten on its own.
  const selection = getFieldSelection(field) ?? undefined;
  const text = selection?.text ?? readFieldText(field);
  if (text.trim().length === 0) {
    panel.showHint('Type a message first, then pick a tone.');
    return;
  }
  pendingSelection = selection;

  rewriteInFlight = true;
  panel.showLoading();
  const requestId = crypto.randomUUID();
  try {
    const res = await sendRequest<ExtensionResponse>({
      type: 'REWRITE',
      requestId,
      text,
      tone,
      instruction,
      avoid,
    });
    if (res.type === 'REWRITE_RESULT' && res.requestId === requestId) {
      lastVariants = res.variants;
      panel.showVariants(res.variants);
    } else if (res.type === 'ERROR') {
      showRequestError((res as ErrorResponse).error);
    } else {
      showRequestError({ code: 'NETWORK', message: 'Unexpected response.' });
    }
  } catch (err) {
    showRequestError({
      code: 'NETWORK',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    rewriteInFlight = false;
    if (queuedRewrite) {
      const next = queuedRewrite;
      queuedRewrite = null;
      void requestRewrite(next.tone, next.instruction, next.avoid);
    }
  }
}

const toast = new UndoToast();

// P3.10: friendly error copy + actions per error code. The server-provided
// message is shown when present since it carries the real cause.
function showRequestError(error: ApiError) {
  const retry = { label: 'Retry', onClick: () => void requestRewrite(selectedTone, lastInstruction || undefined) };
  const openSettings = {
    label: 'Open settings',
    onClick: () => void sendRequest<ExtensionResponse>({ type: 'OPEN_OPTIONS' }),
  };
  const detail = error.message || 'Something went wrong.';
  switch (error.code) {
    case 'NO_KEY':
    case 'INVALID_KEY':
      panel.showError({ code: error.code, message: detail }, [openSettings]);
      break;
    case 'RATE_LIMIT':
      panel.showError({ code: error.code, message: detail }, [retry]);
      break;
    case 'NETWORK':
      panel.showError({ code: error.code, message: detail }, [retry]);
      break;
    case 'SAFETY_BLOCK':
      panel.showError({ code: error.code, message: detail });
      break;
    case 'BAD_OUTPUT':
      panel.showError({ code: error.code, message: detail }, [retry]);
      break;
    case 'TEXT_TOO_SHORT':
      panel.showError({ code: error.code, message: detail });
      break;
    case 'TEXT_TOO_LONG':
      panel.showError({ code: error.code, message: detail });
      break;
  }
}

const panel = new RewritePanel({
  onTone: (tone) => {
    selectedTone = tone;
  },
  onUse: (variant: Variant) => {
    const field = currentField;
    if (!field) return;
    const originalText = readFieldText(field);
    void (async () => {
      const result = await insertText(field, variant.text, pendingSelection);
      if (!result.ok) {
        panel.showHint(
          result.copiedToClipboard
            ? 'Could not insert on this site — text copied. Press Ctrl+V to paste.'
            : 'Could not insert text on this site.',
        );
        return;
      }
      pendingSelection = undefined;
      panel.close();
      toast.onUndo = () => {
        void insertText(field, originalText);
      };
      toast.show();
    })();
  },
  onGenerate: () => {
    // Generate doubles as Regenerate: existing variants are passed as
    // "do not repeat" so a second click yields a fresh set.
    void requestRewrite(
      selectedTone,
      lastInstruction || panel.getInstruction() || undefined,
      lastVariants.length > 0 ? lastVariants.map((v) => v.text) : undefined,
    );
  },
  onInstruction: (instruction: string) => {
    lastInstruction = instruction;
    if (instruction.trim()) {
      recentInstructions.push(instruction.trim());
      if (recentInstructions.length > 5) recentInstructions.shift();
      panel.setRecentInstructions(recentInstructions);
    }
    void requestRewrite(selectedTone, instruction || undefined);
  },
});
panel.selectTone(selectedTone);

const icon = new KindlyIcon(
  (field) => {
    console.log('[Kindly] icon clicked on', field);
    currentField = field;
    panel.open({
      getRect: () => field.getBoundingClientRect(),
      onClose: () => {
        field.focus();
        trigger.refresh(field);
      },
    });
    icon.hide();
    console.log('[Kindly] panel.open called, isOpen =', panel.isOpen);
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
    // While the panel is open the field may legitimately lose focus
    // (e.g. typing in the instruction box) — keep it as currentField.
    if (panel.isOpen) return;
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
