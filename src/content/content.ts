import { getDeepActiveElement, isSupportedField } from './fields';
import {
  getFieldSelection,
  insertAtCursor,
  insertText,
  readFieldText,
  type FieldSelection,
} from './inserter';
import { buildContextBrief } from './context';
import type { ContextBriefData } from '../shared/messages';
import { effectiveNeverRunSites, hostBlocked, normalizeHost } from '../shared/siteMatch';
import { resolveTheme, watchSystemTheme, patternActive } from '../shared/theme';
import { patternBackgroundImage } from '../shared/pattern';
import { debugLog, refreshDebugEnabled } from '../shared/debug';
import { UndoToast } from './toast';
import { KindlyIcon } from './icon';
import { FieldUiController } from './field-ui';
import { getSettings, setSettings } from '../shared/storage';
import { sendRequest } from '../shared/client';
import { sanitizeText } from '../shared/privacy';
import { RewritePanel, type WriteGenerateRequest } from './panel';
import type { ApiError, ExtensionResponse, ToneId, Variant } from '../shared/messages';

type ErrorResponse = Extract<ExtensionResponse, { type: 'ERROR' }>;

void refreshDebugEnabled().then(() => debugLog('content script loaded', window.location.href));

const hostname = window.location.hostname;
/** Canonical host for matching/storing (no leading www.). */
const siteHost = normalizeHost(hostname);

// ---------- Lazy UI ----------
// Nothing is created on page load: no hosts, no shadow roots, no styles.
// The first trusted interaction with a supported field (or a clearly
// active supported field at load) builds the whole UI via ensureUI().
let icon!: KindlyIcon;
let panel!: RewritePanel;
let ui!: FieldUiController;
let toast!: UndoToast;
let uiReady = false;

/** Dead frames (tiny/ad/about:blank iframes) never get UI code at all. */
const deadFrame =
  window !== window.top &&
  (window.innerWidth < 100 || window.innerHeight < 100 || window.location.href === 'about:blank');
let hiddenSites = new Set<string>();
let neverRunSites: string[] = [];
let contextBySite: Record<string, boolean> = {};
let appSettings: import('../shared/messages').Settings | null = null;
let pageContextGlobal = false;
let settingsLoaded = false;
let pendingField: HTMLElement | null = null;
let themePref: 'auto' | 'light' | 'dark' = 'auto';
let unwatchTheme: (() => void) | null = null;

function applyTheme() {
  if (!uiReady) return;
  const mode = resolveTheme(themePref);
  panel.setTheme(mode);
  toast.setTheme(mode);
  void getSettings().then((st) => {
    panel.patternCss = patternActive(st.colorTheme, st.patternStrength)
      ? patternBackgroundImage(mode, st.patternStrength ?? 0)
      : null;
    panel.colorThemePref = st.colorTheme;
    toast.colorThemePref = st.colorTheme;
    toast.setTheme(mode); // re-apply with palette
    panel.setTheme(mode); // re-apply with pattern + palette
  });
}

function watchThemePref() {
  unwatchTheme?.();
  unwatchTheme = themePref === 'auto' ? watchSystemTheme(() => applyTheme()) : null;
  applyTheme();
}

/** Hostname match via the shared helper: exact host + subdomains. */
function siteMatches(patterns: Iterable<string>): boolean {
  return hostBlocked(patterns, siteHost);
}

async function refreshHiddenSites() {
  // Read chrome.storage directly — no service-worker message at page load.
  const settings = await getSettings();
  hiddenSites = new Set(settings.hiddenSites);
  neverRunSites = settings.neverRunSites ?? [];
  pageContextGlobal = settings.pageContextEnabled ?? false;
  contextBySite = settings.usePageContextBySite ?? {};
  appSettings = settings;
  themePref = settings.theme ?? 'auto';
  watchThemePref();
  if (uiReady) {
    panel.setCustomTones(settings.customTones ?? []);
    panel.setSavedReplies(settings.savedReplies ?? []);
  }
}
void refreshHiddenSites().then(() => {
  settingsLoaded = true;
  teardownIfBlocked();
  // A field may have been interacted with before settings arrived.
  if (!uiReady && pendingField) {
    const f = pendingField;
    pendingField = null;
    if (f.isConnected && isSupportedField(f)) {
      ensureUI();
      if (uiReady) ui.focusField(f);
    }
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    themePref =
      (changes.settings.newValue as { theme?: 'auto' | 'light' | 'dark' })?.theme ?? themePref;
    applyTheme();
  }
  if (area === 'local' && changes.settings) {
    const s = changes.settings.newValue as
      | {
          hiddenSites?: string[];
          usePageContextBySite?: Record<string, boolean>;
          customTones?: import('../shared/messages').CustomTone[];
          theme?: 'auto' | 'light' | 'dark';
        }
      | undefined;
    hiddenSites = new Set(s?.hiddenSites ?? []);
    if (s?.theme) {
      themePref = s.theme;
      watchThemePref();
    }
    neverRunSites = (s as { neverRunSites?: string[] } | undefined)?.neverRunSites ?? neverRunSites;
    pageContextGlobal =
      (s as { pageContextEnabled?: boolean } | undefined)?.pageContextEnabled ?? pageContextGlobal;
    contextBySite = s?.usePageContextBySite ?? {};
    if (uiReady) {
      panel.setCustomTones(s?.customTones ?? []);
      panel.setSavedReplies(
        (s as { savedReplies?: import('../shared/messages').SavedReply[] } | undefined)
          ?.savedReplies ?? [],
      );
    }
    void refreshDebugEnabled();
    if (uiReady) ui.resync();
    teardownIfBlocked();
  }
});

/** Site became blocked (or was blocked all along): tear the UI down.
 *  Unblocking works without reload — the next field interaction rebuilds. */
function teardownIfBlocked() {
  if (!isSiteBlocked() || !uiReady) return;
  debugLog('blocked: tearing down UI on', siteHost);
  rewriteEpoch++;
  for (const requestId of activeRequestIds) {
    void sendRequest<ExtensionResponse>({ type: 'CANCEL', requestId }).catch(() => {});
  }
  try {
    panel.destroy();
  } catch {
    /* already gone */
  }
  try {
    icon.destroy();
  } catch {
    /* already gone */
  }
  try {
    toast.destroy();
  } catch {
    /* already gone */
  }
  try {
    ui.dispose();
  } catch {
    /* already gone */
  }
  uiReady = false;
}

/** One blocked check for everything: hidden sites + never-run list. */
function isSiteBlocked(): boolean {
  // Top-level page blocked → this frame is blocked too (cross-origin
  // iframe case); when window.top can't be read we rely on the SW check.
  try {
    if (window.top && window.top !== window) {
      if (siteMatchesTop()) return true;
    }
  } catch {
    /* cross-origin: SW sender check covers it */
  }
  return siteMatches(hiddenSites) || siteMatches(effectiveNeverRunSites(neverRunSites));
}

function siteMatchesTop(): boolean {
  try {
    const topHost = normalizeHost(window.top?.location.hostname ?? '');
    return siteMatches([topHost]) || hostBlocked(effectiveNeverRunSites(neverRunSites), topHost);
  } catch {
    return false;
  }
}

// Page context defaults ON for both tabs; per-site override persists.
function contextEnabled(): boolean {
  if (!pageContextGlobal) return false;
  return contextBySite[siteHost] ?? contextBySite[hostname] ?? true;
}

/** Build the structured brief and, when debug is on, log what was read. */
let contextReadCount = 0;

function collectBrief(field: HTMLElement, draftText: string) {
  if (isSiteBlocked()) {
    debugLog(`context reads: ${contextReadCount} (blocked — no read)`);
    return {
      brief: { platform: 'web' } as ContextBriefData,
      messageCount: 0,
      extractor: 'blocked',
      maskedCount: 0,
    };
  }
  contextReadCount++;
  debugLog(`context read #${contextReadCount} @ ${siteHost}`);
  const built = buildContextBrief(field, draftText);
  const b = built.brief;
  const hasContext = Boolean(b.replyTarget || b.contextText);
  if (!hasContext) {
    debugLog(`context: none on ${hostname} — no readable text (extractor=${built.extractor})`);
  } else {
    debugLog(
      `brief @ ${hostname}: extractor=${built.extractor} platform=${b.platform} ` +
        `messages=${built.messageCount} replyTarget=${(b.replyTarget ?? '').length} chars ` +
        `otherParty=${b.otherParty ?? 'unknown'} lang=${b.replyLanguage ?? '?'} ` +
        `earlier=${b.earlierMessages?.length ?? 0} redacted=${built.maskedCount}`,
    );
    if (b.replyTarget) {
      debugLog('reply_target head:', JSON.stringify(b.replyTarget.slice(0, 160)));
      debugLog('reply_target tail:', JSON.stringify(b.replyTarget.slice(-160)));
    }
  }
  return built;
}

// ---------- Rewrite state ----------

let selectedTone: ToneId = 'professional';
let customToneInstruction: string | undefined;
let lastVariants: Variant[] = [];
let lastInstruction = '';
const recentInstructions: string[] = [];
let pendingSelection: FieldSelection | undefined;
let rewriteInFlight = false;
let rewriteRequestStartedAt = 0;
let writeRequestStartedAt = 0;
// Latest-wins queue: requests while one is in flight are queued,
// not dropped or parallel-fired.
let queuedRewrite: { tone: ToneId; instruction?: string; avoid?: string[] } | null = null;
// Incremented every time the panel closes; in-flight rewrite responses
// from an older epoch are ignored (chrome messages can't be aborted).
let rewriteEpoch = 0;
// In-flight requestIds (rewrite + write) so panel close can cancel them all.
const activeRequestIds = new Set<string>();

function isContextInvalid(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /invalidated|message port|receiving end|context/i.test(m);
}

async function requestRewrite(tone: ToneId, instruction?: string, avoid?: string[]) {
  if (isSiteBlocked()) return;
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
    panel.showHint('Type a few words first, or use the Write tab.');
    return;
  }
  pendingSelection = selection;

  // K-06: mask sensitive items in the user's own draft before it is sent.
  const draftSan = sanitizeText(text);
  const safeText = draftSan.text;
  let maskedTotal = draftSan.total;
  let chipText = '';

  // Structured context brief for rewrite (Q2): built only at request time.
  let brief: ContextBriefData | undefined;
  let messageCount = 0;
  if (contextEnabled()) {
    const built = collectBrief(field, safeText);
    maskedTotal += built.maskedCount;
    brief = built.brief.replyTarget || built.brief.contextText ? built.brief : undefined;
    messageCount = built.messageCount;
    chipText = brief
      ? messageCount > 0
        ? `Used ${messageCount} message${messageCount === 1 ? '' : 's'} from this page`
        : 'Context included'
      : 'No page context found';
  } else {
    chipText = 'Page context off';
  }
  if (maskedTotal > 0) {
    chipText += ` · Hid ${maskedTotal} sensitive item${maskedTotal === 1 ? '' : 's'}`;
  }
  panel.setContextChip(chipText);

  rewriteInFlight = true;
  rewriteRequestStartedAt = Date.now();
  panel.showLoading();
  const requestId = crypto.randomUUID();
  activeRequestIds.add(requestId);
  const epoch = rewriteEpoch;
  try {
    const res = await sendRequest<ExtensionResponse>({
      type: 'REWRITE',
      requestId,
      text: safeText,
      tone,
      instruction,
      avoid,
      brief,
      customToneInstruction,
      brandVoice: appSettings?.brandVoice,
    });
    if (epoch !== rewriteEpoch) return; // panel closed mid-flight — ignore
    if (res.type === 'REWRITE_RESULT' && res.requestId === requestId) {
      lastVariants = res.variants;
      panel.setModelTag(res.model);
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const note =
        res.mode === 'expand' && words <= 8 ? 'Expanded from your short text' : undefined;
      panel.showVariants(res.variants, note);
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
    activeRequestIds.delete(requestId);
    if (epoch === rewriteEpoch && queuedRewrite) {
      const next = queuedRewrite;
      queuedRewrite = null;
      void requestRewrite(next.tone, next.instruction, next.avoid);
    }
  }
}

let writeInFlight = false;
let writeQueued: WriteGenerateRequest | null = null;

async function requestWrite(req: WriteGenerateRequest) {
  if (isSiteBlocked()) return;
  const promptSan = sanitizeText(req.prompt);
  req = {
    ...req,
    prompt: promptSan.text,
    draft: req.draft ? sanitizeText(req.draft).text : req.draft,
    instruction: req.instruction ? sanitizeText(req.instruction).text : req.instruction,
  };
  if (writeInFlight) {
    writeQueued = req;
    return;
  }
  writeInFlight = true;
  writeRequestStartedAt = Date.now();
  panel.showWriteLoading();
  const requestId = crypto.randomUUID();
  activeRequestIds.add(requestId);
  const epoch = rewriteEpoch;
  try {
    const res = await sendRequest<ExtensionResponse>({
      type: 'WRITE',
      requestId,
      prompt: req.prompt,
      tone: req.tone,
      length: req.length,
      instruction: req.instruction,
      context: req.brief?.contextText,
      brief: req.brief,
      draft: req.draft,
      customToneInstruction: req.customToneInstruction,
      brandVoice: appSettings?.brandVoice,
      savedReply: req.savedReply,
    });
    if (epoch !== rewriteEpoch) return;
    if (res.type === 'WRITE_RESULT' && res.requestId === requestId) {
      panel.setModelTag(res.model);
      panel.showWriteVariants(res.variants);
    } else if (res.type === 'ERROR') {
      panel.showWriteError((res as ErrorResponse).error.message || 'Something went wrong.');
    } else {
      panel.showWriteError('Unexpected response.');
    }
  } catch (err) {
    if (isContextInvalid(err)) {
      panel.showWriteError('Kindly was reloaded — refresh this page to keep using it.');
    } else {
      panel.showWriteError(err instanceof Error ? err.message : String(err));
    }
  } finally {
    writeInFlight = false;
    activeRequestIds.delete(requestId);
    if (epoch === rewriteEpoch && writeQueued) {
      const next = writeQueued;
      writeQueued = null;
      void requestWrite(next);
    }
  }
}

// P3.10: friendly error copy + actions per error code. The server-provided
// message is shown when present since it carries the real cause.
function showRequestError(error: ApiError) {
  const retry = {
    label: 'Retry',
    onClick: () => void requestRewrite(selectedTone, lastInstruction || undefined),
  };
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
    case 'TIMEOUT':
      panel.showError({ code: error.code, message: 'Request timed out — try again.' }, [retry]);
      break;
    case 'KEY_LOCKED':
    case 'SITE_BLOCKED':
      panel.showError({ code: error.code, message: detail });
      break;
  }
}

// ---------- Panel ----------

// ---------- Lazy UI init ----------
// Built on first trusted field interaction — see bootstrap listeners below.
function ensureUI() {
  if (uiReady || isSiteBlocked() || !settingsLoaded) return;
  uiReady = true;
  toast = new UndoToast();

  panel = new RewritePanel({
    onTone: (tone, customInstruction) => {
      if (tone) {
        selectedTone = tone;
        customToneInstruction = undefined;
      } else if (customInstruction !== undefined) {
        customToneInstruction = customInstruction;
      }
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
    // ---------- Write mode (P6.x) ----------
    onWriteGenerate: (req) => {
      void requestWrite(req);
    },
    onWriteUse: (variant, mode) => {
      const field = ui?.activeField;
      if (!field) return;
      const originalText = readFieldText(field);
      const insert = mode === 'cursor' ? insertAtCursor : insertText;
      void (async () => {
        const result = await insert(field, variant.text);
        if (!result.ok) {
          panel.showWriteHint(
            result.copiedToClipboard
              ? 'Could not insert on this site — text copied. Press Ctrl+V to paste.'
              : 'Could not insert text on this site.',
          );
          return;
        }
        panel.close();
        toast.onUndo = () => {
          void insertText(field, originalText);
        };
        toast.show();
      })();
    },
    onWriteInstruction: (instruction) => {
      const req = panel.buildFollowUpRequest(instruction);
      if (req) void requestWrite(req);
    },
    getWriteContext: (): ContextBriefData | undefined => {
      if (isSiteBlocked() || !contextEnabled()) return undefined;
      const field: HTMLElement | null | undefined = ui?.activeField;
      if (!field) return undefined;
      const built = collectBrief(field, '');
      return built.brief.replyTarget || built.brief.contextText ? built.brief : undefined;
    },
  });
  panel.selectTone(selectedTone);
  if (appSettings) {
    panel.setCustomTones(appSettings.customTones ?? []);
    panel.setSavedReplies(appSettings.savedReplies ?? []);
  }

  // ---------- Icon + field UI state machine ----------

  icon = new KindlyIcon(
    (field) => {
      if (field !== ui.activeField) ui.focusField(field);
      ui.openPanel();
    },
    () => {
      if (!confirm(`Hide Kindly on ${hostname}? You can re-enable it in settings.`)) return;
      void setSettings({ hiddenSites: [...hiddenSites, siteHost] }).then(() => {
        hiddenSites.add(siteHost);
        ui.resync();
      });
    },
  );

  ui = new FieldUiController(icon, panel, {
    isSiteHidden: isSiteBlocked,
    getDeepActiveElement: () => getDeepActiveElement(),
    onPanelClosed: () => {
      rewriteEpoch++;
      // Actually abort in-flight Gemini calls, not just ignore their results.
      for (const requestId of activeRequestIds) {
        void sendRequest<ExtensionResponse>({ type: 'CANCEL', requestId }).catch(() => {});
      }
    },
  });

  applyTheme();
  installPageListeners();
  debugLog('ui: initialized on first field interaction');
}

// Bootstrap: first trusted interaction with a supported field builds the UI.
// Runs before the regular listeners; dead frames (tiny/ad/about:blank
// iframes) never register anything.
if (!deadFrame) {
  const maybeField = (e: Event) => {
    if (uiReady || !e.isTrusted) return;
    const t = (e.composedPath?.()[0] ?? e.target) as Element | null;
    if (t instanceof HTMLElement && isSupportedField(t)) {
      if (settingsLoaded) ensureUI();
      else pendingField = t;
    }
  };
  for (const type of ['pointerdown', 'keydown', 'input', 'focusin']) {
    document.addEventListener(type, maybeField, true);
  }
  // Autofocused supported field on a focused page — no DOM footprint
  // otherwise; background tabs wait for real interaction.
  const active = getDeepActiveElement();
  if (document.hasFocus() && active instanceof HTMLElement && isSupportedField(active)) {
    ensureUI();
  }
}

function fieldFromEvent(event: Event): HTMLElement | null {
  // composedPath pierces shadow roots so fields inside them are seen (P2.6).
  const target = (event.composedPath?.()[0] ?? event.target) as Element | null;
  return isSupportedField(target) ? target : null;
}

function installPageListeners() {
  document.addEventListener('focusin', (event) => {
    if (!uiReady || !event.isTrusted) return;
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
    if (uiReady) ui.scheduleBlurCheck();
  });

  // `input` is composed, so it crosses shadow boundaries.
  document.addEventListener('input', (event) => {
    if (!uiReady || !event.isTrusted) return;
    const field = fieldFromEvent(event);
    if (field) ui.noteInput(field);
  });

  // ---------- Keyboard shortcuts (P7.5) ----------
  // Alt+R opens the panel on the focused field, Alt+Shift+R re-runs the
  // last tone, Ctrl+Enter uses the selected variant, Esc closes.
  document.addEventListener('keydown', (e) => {
    if (!uiReady || !e.isTrusted) return;
    if (e.key === 'Escape' && panel.isOpen) {
      e.preventDefault();
      panel.close();
      return;
    }
    if (panel.isOpen && e.ctrlKey && !e.altKey && !e.metaKey && e.key === 'Enter') {
      e.preventDefault();
      panel.useSelected();
      return;
    }
    if (
      e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      e.key.toLowerCase() === 'r' &&
      ui?.activeField &&
      !isSiteBlocked()
    ) {
      e.preventDefault();
      if (e.shiftKey) {
        void requestRewrite(selectedTone, lastInstruction || undefined);
      } else if (!panel.isOpen) {
        ui.openPanel();
      }
    }
  });

  // ---------- Resync on tab return / visibility (icon-loss fix) ----------
  // focusin does NOT refire when a tab regains focus with the same field
  // still active — without these listeners the icon stays hidden until the
  // next keystroke. All paths funnel into ui.resyncFromDom().

  const STALE_REQUEST_MS = 90_000;

  function checkStaleRequests() {
    const now = Date.now();
    const rewriteStale = rewriteInFlight && now - rewriteRequestStartedAt > STALE_REQUEST_MS;
    const writeStale = writeInFlight && now - writeRequestStartedAt > STALE_REQUEST_MS;
    if (!rewriteStale && !writeStale) return;
    debugLog('resync: stale in-flight request(s) — cancelling');
    rewriteEpoch++; // late responses are ignored
    for (const requestId of activeRequestIds) {
      void sendRequest<ExtensionResponse>({ type: 'CANCEL', requestId }).catch(() => {});
    }
    rewriteInFlight = false;
    writeInFlight = false;
    panel.showError({ code: 'NETWORK', message: 'Connection lost — try again.' }, [
      {
        label: 'Retry',
        onClick: () => void requestRewrite(selectedTone, lastInstruction || undefined),
      },
    ]);
  }

  function resyncUi(reason: string) {
    if (!uiReady) return;
    debugLog(`resync: ${reason} (state=${ui.state} field=${ui.activeField ? 'set' : 'none'})`);
    ui.resyncFromDom();
    checkStaleRequests();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resyncUi('visibilitychange→visible');
  });
  window.addEventListener('focus', () => resyncUi('window focus'));
  window.addEventListener('pageshow', () => resyncUi('pageshow'));

  // Light consistency check: 1s interval, only while the page is visible.
  // Corrects any state where the icon should show but doesn't (e.g. a
  // throttled timer fired late). Cost: one textContent read per second.
  window.setInterval(() => {
    if (!uiReady || document.visibilityState !== 'visible') return;
    // Only correct states that could be wrongly hidden — 'icon'/'panel' are
    // already correct, 'hidden-site' only changes via storage events.
    if (ui.state === 'icon' || ui.state === 'panel' || ui.state === 'hidden-site') return;
    const field = ui.activeField;
    if (!field || !field.isConnected) return;
    const before = ui.state;
    ui.trigger.refresh(field);
    ui.resync();
    if (ui.state !== before) debugLog(`resync: interval corrected ${before}→${ui.state}`);
  }, 1000);
}

// Toolbar popup query (P7.6): reports this site's hostname + hidden state.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as { type?: string };
  if (msg?.type === 'GET_SITE_INFO') {
    sendResponse({ type: 'SITE_INFO', hostname: siteHost, hidden: isSiteBlocked() });
    return false;
  }
  return false;
});
