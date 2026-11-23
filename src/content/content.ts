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
import { FieldUiController } from './field-ui';
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
    ui?.resync();
  }
});

function siteIsHidden(): boolean {
  return hiddenSites.has(hostname) || hiddenSites.has(window.location.host);
}

// ---------- Rewrite state ----------

let selectedTone: ToneId = 'professional';
let lastVariants: Variant[] = [];
let lastInstruction = '';
const recentInstructions: string[] = [];
let pendingSelection: FieldSelection | undefined;
let rewriteInFlight = false;
// Latest-wins queue: requests while one is in flight are queued,
// not dropped or parallel-fired.
let queuedRewrite: { tone: ToneId; instruction?: string; avoid?: string[] } | null = null;

function isContextInvalid(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /invalidated|message port|receiving end|context/i.test(m);
}

async function requestRewrite(tone: ToneId, instruction?: string, avoid?: string[]) {
  if (rewriteInFlight) {
    queuedRewrite = { tone, instruction, avoid };
    return;
  }
  const field = ui?.activeField;
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
    if (isContextInvalid(err)) {
      panel.showHint('Kindly was reloaded — refresh this page to keep using it.');
    } else {
      showRequestError({
        code: 'NETWORK',
        message: err instanceof Error ? err.message : String(err),
      });
    }
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

// ---------- Panel ----------

const panel = new RewritePanel({
  onTone: (tone) => {
    selectedTone = tone;
  },
  onUse: (variant: Variant) => {
    const field = ui?.activeField;
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

// ---------- Icon + field UI state machine ----------

const icon = new KindlyIcon(
  (field) => {
    if (field !== ui.activeField) ui.focusField(field);
    ui.openPanel();
  },
  () => {
    if (!confirm(`Hide Kindly on ${hostname}? You can re-enable it in settings.`)) return;
    void setSettings({ hiddenSites: [...hiddenSites, hostname] }).then(() => {
      hiddenSites.add(hostname);
      ui.resync();
    });
  },
);

const ui = new FieldUiController(icon, panel, {
  isSiteHidden: siteIsHidden,
  getDeepActiveElement: () => getDeepActiveElement(),
});

function fieldFromEvent(event: Event): HTMLElement | null {
  // composedPath pierces shadow roots so fields inside them are seen (P2.6).
  const target = (event.composedPath?.()[0] ?? event.target) as Element | null;
  return isSupportedField(target) ? target : null;
}

document.addEventListener('focusin', (event) => {
  // Focus moving inside our own panel (e.g. instruction input) is not a
  // field change — ignore it entirely.
  if (panel.handlesEvent(event)) return;
  const field = fieldFromEvent(event);
  if (field) {
    ui.focusField(field);
  } else {
    ui.unfocusField();
  }
});

document.addEventListener('focusout', () => {
  ui.scheduleBlurCheck();
});

// `input` is composed, so it crosses shadow boundaries.
document.addEventListener('input', (event) => {
  const field = fieldFromEvent(event);
  if (field) ui.noteInput(field);
});
