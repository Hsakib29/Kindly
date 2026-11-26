// Rewrite panel: Shadow DOM UI anchored to the active field.
// Structure: tone chips, results body, extra-instruction row, action footer.

import { patternBackgroundImage, PATTERN_BACKGROUND_SIZE } from '../shared/pattern';
import {
  TONE_IDS,
  type ApiError,
  type ContextBriefData,
  type CustomTone,
  type SavedReply,
  type ToneId,
  type Variant,
} from '../shared/messages';
import { PRODUCT_NAME } from '../shared/brand';
import { themeCssVars, type ThemeMode } from '../shared/theme';
import { debugLog } from '../shared/debug';

const LIGHT_VARS = themeCssVars('light');
const DARK_VARS = themeCssVars('dark');

const PANEL_WIDTH = 360;
const PANEL_MAX_HEIGHT = 460;
const EDGE_GAP = 8;
const VIEWPORT_MARGIN = 8;

const TONE_LABELS: Record<ToneId, string> = {
  professional: 'Professional',
  warm: 'Warm',
  short: 'Short',
  direct: 'Direct',
  empathetic: 'Empathetic',
  friendly: 'Friendly',
  grammar: 'Fix grammar only',
};

export interface PanelAnchor {
  getRect: () => DOMRect;
  onClose?: () => void;
}

export interface WriteGenerateRequest {
  prompt: string;
  tone?: ToneId;
  length?: 'short' | 'medium' | 'long';
  instruction?: string;
  brief?: ContextBriefData;
  customToneInstruction?: string;
  /** Saved reply attached as knowledge (P7.4). */
  savedReply?: SavedReply;
  /** Existing draft to revise (follow-up instructions, P6.6). */
  draft?: string;
}

export interface PanelCallbacks {
  /** tone=null means a custom preset was picked (customInstruction set). */
  onTone?: (tone: ToneId | null, customInstruction?: string) => void;
  onUse?: (variant: Variant) => void;
  onGenerate?: () => void;
  onInstruction?: (instruction: string) => void;
  onWriteGenerate?: (req: WriteGenerateRequest) => void;
  onWriteUse?: (variant: Variant, mode: 'replace' | 'cursor') => void;
  onWriteInstruction?: (instruction: string) => void;
  /** Returns the structured context brief to send (or undefined if none). */
  getWriteContext?: () => ContextBriefData | undefined;
}

export class RewritePanel {
  private host: HTMLDivElement;
  private panel: HTMLDivElement;
  private chipsEl: HTMLElement;
  private bodyEl: HTMLElement;
  private instructionInput: HTMLInputElement;
  private recentEl: HTMLElement;
  private useButton: HTMLButtonElement;
  private generateButton: HTMLButtonElement;
  private copyButton: HTMLButtonElement;
  private modelTag: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;
  private anchor: PanelAnchor | null = null;
  private rafId = 0;
  private variants: Variant[] = [];
  private selectedVariant = -1;
  // Write tab state
  private writePromptEl!: HTMLTextAreaElement;
  private writeToneEl!: HTMLSelectElement;
  private writeLenEl!: HTMLSelectElement;
  private writeBodyEl!: HTMLElement;
  private writeInstrInput!: HTMLInputElement;
  private writeUseBtn!: HTMLButtonElement;
  private writeGenBtn!: HTMLButtonElement;
  private writeCopyBtn!: HTMLButtonElement;
  private writeCursorBtn!: HTMLButtonElement;
  private writeVariants: Variant[] = [];
  private writeSelected = -1;
  private activeTab: 'rewrite' | 'write' = 'rewrite';
  private writeLastInstruction = '';
  private customTones: CustomTone[] = [];
  private savedReplies: SavedReply[] = [];
  private replySelectEl!: HTMLSelectElement;
  // Rewrite-tab context chip
  private ctxChipEl!: HTMLElement;
  private onDocumentClick: ((e: Event) => void) | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private callbacks: PanelCallbacks = {};

  /** Apply the resolved theme to the shadow host (P8 theming). */
  setTheme(mode: ThemeMode) {
    this.host.dataset.theme = mode;
    this.host.style.colorScheme = mode;
    // Subtle botanical pattern behind the panel.
    this.host.style.backgroundImage = patternBackgroundImage(mode, 10);
    this.host.style.backgroundSize = PATTERN_BACKGROUND_SIZE;
    this.host.style.backgroundRepeat = 'repeat';
  }

  constructor(callbacks: PanelCallbacks = {}) {
    this.callbacks = callbacks;
    this.host = document.createElement('div');
    this.host.style.cssText =
      'position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none;';
    const shadow = this.host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { color-scheme: light dark; }
        :host([data-theme='light']) { ${LIGHT_VARS} }
        :host([data-theme='dark']) { ${DARK_VARS} }
        .panel {
          pointer-events: auto;
          width: ${PANEL_WIDTH}px;
          max-height: ${PANEL_MAX_HEIGHT}px;
          display: flex;
          flex-direction: column;
          background: var(--surface);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 12px;
          box-shadow: 0 8px 30px var(--shadow);
          font: 13px/1.4 system-ui, sans-serif;
          overflow: hidden;
        }
        .header {
          padding: 8px 10px 4px;
          font-weight: 600;
          font-size: 12px;
          color: var(--text-secondary);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 10px 8px; }
        .chip {
          border: 1px solid var(--control-border);
          background: var(--surface);
          color: var(--text);
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 12px;
          cursor: pointer;
        }
        .chip:hover { border-color: var(--accent); }
        .chip.selected { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); }
        .chip:focus-visible, .card:focus-visible, button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible {
          outline: 2px solid var(--focus-ring); outline-offset: 1px;
        }
        .body { padding: 0 10px 10px; overflow-y: auto; flex: 1; min-height: 60px; }
        .placeholder, .hint { color: var(--text-secondary); padding: 14px 4px; text-align: center; }
        .card {
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 8px 10px;
          margin-bottom: 8px;
          cursor: pointer;
          background: var(--surface);
        }
        .card:hover { border-color: var(--control-border); }
        .card.selected { border: 2px solid var(--accent); background: var(--accent-tint); padding: 7px 9px; }
        .card .label { font-size: 11px; color: var(--text-secondary); margin-bottom: 2px; }
        .card .text { white-space: pre-wrap; word-break: break-word; max-height: 140px; overflow-y: auto; }
        .instruction { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--divider); }
        .instruction input, .write-instruction input, .write-prompt, .write-controls select {
          border: 1px solid var(--control-border);
          border-radius: 8px;
          background: var(--surface);
          color: var(--text);
          font: inherit;
        }
        .instruction input:focus, .write-instruction input:focus, .write-prompt:focus, .write-controls select:focus {
          outline: 2px solid var(--focus-ring); outline-offset: 1px; border-color: var(--accent);
        }
        .instruction input::placeholder, .write-instruction input::placeholder, .write-prompt::placeholder {
          color: var(--placeholder);
        }
        .instruction input, .write-instruction input {
          flex: 1; min-width: 0; padding: 6px 8px;
        }
        .write-prompt { width: 100%; box-sizing: border-box; padding: 7px 9px; resize: vertical; min-height: 44px; }
        .write-controls select { padding: 4px 6px; font-size: 12px; }
        .instruction button, .actions button, .recent button, .write-instruction button,
        .write-actions .generate, .write-actions .copy, .write-actions .cursor, .error-box button {
          border: 1px solid var(--control-border);
          background: var(--surface);
          color: var(--text);
          border-radius: 8px;
          padding: 6px 10px;
          font: inherit;
          cursor: pointer;
        }
        .instruction button:hover, .actions button:hover, .write-instruction button:hover,
        .write-actions .generate:hover, .write-actions .copy:hover, .write-actions .cursor:hover,
        .error-box button:hover, .recent button:hover { border-color: var(--accent); }
        .actions { display: flex; gap: 8px; padding: 8px 10px; border-top: 1px solid var(--divider); }
        .actions .primary, .write-actions .primary {
          flex: 1;
          background: var(--accent);
          border: 1px solid var(--accent);
          color: var(--text-on-accent);
          border-radius: 8px;
          font-weight: 600;
          padding: 6px 10px;
          font: inherit;
          cursor: pointer;
        }
        .actions .primary:disabled, .write-actions .primary:disabled {
          background: var(--border);
          border-color: var(--border);
          color: var(--text);
          opacity: 0.75;
          cursor: default;
        }
        .actions button:disabled, .write-actions .generate:disabled,
        .write-actions .copy:disabled, .write-actions .cursor:disabled {
          color: var(--text-disabled); border-color: var(--border); cursor: default;
        }
        .recent { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 10px 8px; }
        .recent button { font-size: 11px; padding: 3px 8px; border-radius: 999px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .skeleton {
          height: 56px; border-radius: 10px; margin-bottom: 8px;
          background: linear-gradient(90deg, var(--skeleton-base) 25%, var(--skeleton-shimmer) 50%, var(--skeleton-base) 75%);
          background-size: 200% 100%; animation: shimmer 1.2s infinite;
        }
        @keyframes shimmer { to { background-position: -200% 0; } }
        .result-note { font-size: 11px; color: var(--text-secondary); margin: -4px 0 8px; }
        .error-box { padding: 10px; font-size: 12px; }
        .error-box .msg { margin-bottom: 8px; color: var(--danger); }
        .model-tag { font-size: 10px; color: var(--text-secondary); margin-left: auto; margin-right: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
        .header .close {
          border: none; background: transparent; color: var(--text-secondary);
          font-size: 16px; line-height: 1; width: 30px; height: 30px; border-radius: 8px;
          cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;
        }
        .header .close:hover { background: var(--accent-tint); color: var(--text); }
        .tabs { display: flex; gap: 4px; padding: 6px 10px 0; }
        .tab-btn {
          border: none; background: transparent; color: var(--text-secondary);
          font: inherit; font-weight: 600; font-size: 12px; padding: 5px 10px;
          border-radius: 8px 8px 0 0; cursor: pointer; border-bottom: 2px solid transparent;
        }
        .tab-btn:hover { color: var(--text); }
        .tab-btn.active { color: var(--text); border-bottom-color: var(--accent); }
        .ctx-row { display: flex; align-items: center; gap: 8px; padding: 2px 10px 6px; flex-wrap: wrap; }
        .ctx-chip { font-size: 11px; color: var(--text-secondary); margin-left: auto; }
        .page { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
        .page[hidden] { display: none; }
        .write-form { padding: 8px 10px 4px; }
        .write-body { padding: 0 10px 10px; }
        .write-instruction { display: flex; gap: 6px; padding: 6px 10px; border-top: 1px solid var(--divider); }
        .write-actions { display: flex; gap: 8px; padding: 8px 10px; border-top: 1px solid var(--divider); }
        .write-actions .generate { white-space: nowrap; }
        .ctx-toggle { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-secondary); cursor: pointer; margin-left: auto; }
        .preview-btn { border: none; background: transparent; color: var(--accent); font: inherit; font-size: 12px; padding: 4px 0; cursor: pointer; text-decoration: underline; }
        .ctx-preview {
          max-height: 140px; overflow-y: auto;
          background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
          padding: 8px; font-size: 11px; white-space: pre-wrap; word-break: break-word; margin: 4px 0 0;
          color: var(--text);
        }
      </style>
      <div class="panel" role="dialog" aria-label="Kindly">
        <div class="header"><span>${PRODUCT_NAME}</span><span class="model-tag"></span><button type="button" class="close" aria-label="Close">×</button></div>
        <div class="tabs" role="tablist">
          <button type="button" class="tab-btn active" data-tab="rewrite" role="tab" aria-selected="true">Rewrite</button>
          <button type="button" class="tab-btn" data-tab="write" role="tab" aria-selected="false">Write</button>
        </div>
        <div class="page" id="page-rewrite">
          <div class="chips" role="toolbar" aria-label="Tone"></div>
          <div class="ctx-row">
            <span class="ctx-chip"></span>
          </div>
          <div class="body"></div>
          <div class="recent" hidden></div>
          <div class="instruction">
            <input type="text" placeholder="Add an instruction… (e.g. offer a refund)" aria-label="Extra instruction" />
            <button type="button">Apply</button>
          </div>
          <div class="actions">
            <button type="button" class="generate">Generate</button>
            <button type="button" class="copy" disabled>Copy</button>
            <button type="button" class="primary" disabled>Use</button>
          </div>
        </div>
        <div class="page" id="page-write" hidden>
          <div class="write-form">
            <textarea class="write-prompt" rows="2" placeholder="What should it say? e.g. apologize for the delay and offer a refund" aria-label="What to write"></textarea>
            <div class="write-controls">
              <select class="tone-select" aria-label="Tone"></select>
              <select class="len-select" aria-label="Length">
                <option value="">Any length</option>
                <option value="short">Short</option>
                <option value="medium">Medium</option>
                <option value="long">Long</option>
              </select>
              <select class="reply-select" aria-label="Attach saved reply" hidden></select>
            </div>
          </div>
          <div class="body write-body"></div>
          <div class="write-instruction">
            <input type="text" placeholder="Follow-up: shorter, mention opening hours…" aria-label="Follow-up instruction" />
            <button type="button">Apply</button>
          </div>
          <div class="write-actions">
            <button type="button" class="generate">Generate</button>
            <button type="button" class="copy" disabled>Copy</button>
            <button type="button" class="primary" disabled>Use</button>
            <button type="button" class="cursor" disabled title="Insert at cursor instead of replacing">At cursor</button>
          </div>
        </div>
      </div>
    `;

    // Keep focus in the page field while clicking non-input controls
    // (chips, cards, buttons). Form controls MUST be exempt or they can
    // never receive focus — that was the Write-tab bug.
    shadow.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]'))
        return;
      e.preventDefault();
    });

    // Keep keystrokes and edits inside our fields from reaching page-level
    // shortcut handlers (Gmail 'c'/'e', ChatGPT submit, etc.).
    const stopLeak = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select')) e.stopPropagation();
    };
    for (const type of ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'paste']) {
      shadow.addEventListener(type, stopLeak);
    }

    this.panel = shadow.querySelector('.panel') as HTMLDivElement;
    this.chipsEl = shadow.querySelector('.chips') as HTMLElement;
    this.bodyEl = shadow.querySelector('.body') as HTMLElement;
    this.instructionInput = shadow.querySelector(
      '.instruction input',
    ) as HTMLInputElement;
    this.recentEl = shadow.querySelector('.recent') as HTMLElement;
    this.useButton = shadow.querySelector('.primary') as HTMLButtonElement;
    this.generateButton = shadow.querySelector(
      '.actions .generate',
    ) as HTMLButtonElement;
    this.copyButton = shadow.querySelector('.actions .copy') as HTMLButtonElement;
    this.modelTag = shadow.querySelector('.model-tag') as HTMLElement;

    // ---------- Write tab wiring ----------
    const writePage = shadow.querySelector('#page-write') as HTMLElement;
    this.writePromptEl = writePage.querySelector('.write-prompt') as HTMLTextAreaElement;
    this.writeToneEl = writePage.querySelector('.tone-select') as HTMLSelectElement;
    this.writeLenEl = writePage.querySelector('.len-select') as HTMLSelectElement;
    this.replySelectEl = writePage.querySelector('.reply-select') as HTMLSelectElement;
    this.writeBodyEl = writePage.querySelector('.write-body') as HTMLElement;
    this.writeInstrInput = writePage.querySelector(
      '.write-instruction input',
    ) as HTMLInputElement;
    this.writeUseBtn = writePage.querySelector('.write-actions .primary') as HTMLButtonElement;
    this.writeGenBtn = writePage.querySelector('.write-actions .generate') as HTMLButtonElement;
    this.writeCopyBtn = writePage.querySelector('.write-actions .copy') as HTMLButtonElement;
    this.writeCursorBtn = writePage.querySelector('.write-actions .cursor') as HTMLButtonElement;

    // Tone selector: "No preference" + the shared tone list.
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Any tone';
    this.writeToneEl.appendChild(none);
    for (const tone of TONE_IDS) {
      const opt = document.createElement('option');
      opt.value = tone;
      opt.textContent = TONE_LABELS[tone];
      this.writeToneEl.appendChild(opt);
    }

    // ---------- Rewrite-tab context row ----------
    const rewritePage = shadow.querySelector('#page-rewrite') as HTMLElement;
    this.ctxChipEl = rewritePage.querySelector('.ctx-chip') as HTMLElement;

    // Tab switching.
    for (const btn of Array.from(shadow.querySelectorAll<HTMLButtonElement>('.tab-btn'))) {
      btn.addEventListener('click', () => this.setTab(btn.dataset.tab === 'write' ? 'write' : 'rewrite'));
    }

    this.writeGenBtn.addEventListener('click', () => {
      const req = this.buildWriteRequest();
      if (req) this.callbacks.onWriteGenerate?.(req);
    });
    this.writeInstrInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = this.writeInstrInput.value;
        if (v.trim()) this.callbacks.onWriteInstruction?.(v);
      }
    });
    (writePage.querySelector('.write-instruction button') as HTMLButtonElement).addEventListener(
      'click',
      () => {
        const v = this.writeInstrInput.value;
        if (v.trim()) this.callbacks.onWriteInstruction?.(v);
      },
    );
    this.writeUseBtn.addEventListener('click', () => {
      const v = this.writeVariants[this.writeSelected];
      if (v) this.callbacks.onWriteUse?.(v, 'replace');
    });
    this.writeCursorBtn.addEventListener('click', () => {
      const v = this.writeVariants[this.writeSelected];
      if (v) this.callbacks.onWriteUse?.(v, 'cursor');
    });
    this.writeCopyBtn.addEventListener('click', () => {
      const v = this.writeVariants[this.writeSelected];
      if (!v) return;
      void navigator.clipboard.writeText(v.text).then(() => {
        this.writeCopyBtn.textContent = 'Copied';
        window.setTimeout(() => (this.writeCopyBtn.textContent = 'Copy'), 1500);
      });
    });

    this.buildChips();
    this.showPlaceholder('Pick a tone, then hit Generate.');

    this.instructionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.callbacks.onInstruction?.(this.instructionInput.value);
      }
    });
    (shadow.querySelector('.instruction button') as HTMLButtonElement).addEventListener(
      'click',
      () => this.callbacks.onInstruction?.(this.instructionInput.value),
    );
    this.useButton.addEventListener('click', () => {
      const v = this.variants[this.selectedVariant];
      if (v) this.callbacks.onUse?.(v);
    });
    (shadow.querySelector('.close') as HTMLButtonElement).addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });
    this.generateButton.addEventListener('click', () => this.callbacks.onGenerate?.());
    this.copyButton.addEventListener('click', () => {
      const v = this.variants[this.selectedVariant];
      if (!v) return;
      void navigator.clipboard.writeText(v.text).then(() => {
        this.copyButton.textContent = 'Copied';
        window.setTimeout(() => (this.copyButton.textContent = 'Copy'), 1500);
      });
    });

    // Reposition whenever the panel's own size changes (content loads,
    // variants arrive, errors render) so it never outgrows the viewport.
    this.resizeObserver = new ResizeObserver(() => this.scheduleUpdate());
    this.resizeObserver.observe(this.panel);

    (document.documentElement || document.body).appendChild(this.host);
    this.host.style.display = 'none';
  }

  // ---------- Public API ----------

  /** True when the event happened inside this panel's shadow DOM. */
  handlesEvent(e: Event): boolean {
    return e.composedPath().includes(this.host);
  }

  get isOpen(): boolean {
    return this.anchor !== null;
  }

  getInstruction(): string {
    return this.instructionInput.value;
  }

  /** Show which model produced the current variants (router transparency). */
  setModelTag(model?: string) {
    this.modelTag.textContent = model ?? '';
  }

  /** Keyboard shortcut: Use the currently selected variant (P7.5). */
  useSelected() {
    if (this.activeTab === 'write') {
      const v = this.writeVariants[this.writeSelected];
      if (v) this.callbacks.onWriteUse?.(v, 'replace');
    } else {
      const v = this.variants[this.selectedVariant];
      if (v) this.callbacks.onUse?.(v);
    }
  }

  /** Status chip on the Rewrite tab: what context was (or wasn't) read. */
  setContextChip(text: string) {
    this.ctxChipEl.textContent = text;
  }

  /** Show the last few instructions as quick chips (P3.8). */
  setRecentInstructions(instructions: string[]) {
    this.recentEl.innerHTML = '';
    this.recentEl.hidden = instructions.length === 0;
    for (const text of instructions.slice(-3).reverse()) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = text;
      chip.title = text;
      chip.addEventListener('click', () => {
        this.instructionInput.value = text;
        this.callbacks.onInstruction?.(text);
      });
      this.recentEl.appendChild(chip);
    }
  }

  open(anchor: PanelAnchor) {
    this.close();
    this.anchor = anchor;

    this.onDocumentClick = (e) => {
      if (!e.composedPath().includes(this.host)) this.close();
    };
    document.addEventListener('click', this.onDocumentClick, true);

    this.onKeyDown = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        // Chip keyboard navigation (P3.2).
        const chips = Array.from(this.chipsEl.querySelectorAll<HTMLButtonElement>('.chip'));
        const idx = chips.findIndex((c) => c.classList.contains('selected'));
        const next =
          e.key === 'ArrowRight'
            ? Math.min(idx + 1, chips.length - 1)
            : Math.max(idx - 1, 0);
        if (idx !== -1 && next !== idx) {
          e.preventDefault();
          chips[next].focus();
          chips[next].click();
        }
      }
    };
    this.host.addEventListener('keydown', this.onKeyDown, true);

    window.addEventListener('scroll', this.scheduleUpdate, { capture: true, passive: true });
    window.addEventListener('resize', this.scheduleUpdate, { passive: true });

    this.host.style.display = 'block';
    this.updatePosition();
    debugLog('panel opened');
  }

  close() {
    const anchor = this.anchor;
    if (!anchor) return;
    this.anchor = null;
    if (this.onDocumentClick) {
      document.removeEventListener('click', this.onDocumentClick, true);
      this.onDocumentClick = null;
    }
    if (this.onKeyDown) {
      this.host.removeEventListener('keydown', this.onKeyDown, true);
      this.onKeyDown = null;
    }
    window.removeEventListener('scroll', this.scheduleUpdate, { capture: true });
    window.removeEventListener('resize', this.scheduleUpdate);
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.host.style.display = 'none';
    anchor.onClose?.();
  }

  destroy() {
    this.close();
    this.resizeObserver?.disconnect();
    this.host.remove();
  }

  // ---------- Tone chips (P3.2) ----------

  private buildChips() {
    this.chipsEl.innerHTML = '';
    for (const tone of TONE_IDS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = TONE_LABELS[tone];
      chip.dataset.tone = tone;
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', () => {
        this.selectTone(tone);
        this.callbacks.onTone?.(tone);
      });
      this.chipsEl.appendChild(chip);
    }
    // Custom tone presets (P7.2) — pinned first.
    const sorted = [...this.customTones].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    for (const t of sorted) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip custom-tone';
      chip.textContent = t.name;
      chip.dataset.tone = `custom:${t.id}`;
      chip.title = t.instruction;
      chip.setAttribute('aria-pressed', 'false');
      chip.addEventListener('click', () => {
        for (const c of this.chipsEl.querySelectorAll('.chip')) {
          c.classList.remove('selected');
          c.setAttribute('aria-pressed', 'false');
        }
        chip.classList.add('selected');
        chip.setAttribute('aria-pressed', 'true');
        this.callbacks.onTone?.(null, t.instruction);
      });
      this.chipsEl.appendChild(chip);
    }
  }

  /** Update saved replies for the Write-tab attach selector (P7.4). */
  setSavedReplies(replies: SavedReply[]) {
    this.savedReplies = replies;
    this.replySelectEl.innerHTML = '';
    this.replySelectEl.hidden = replies.length === 0;
    if (replies.length === 0) return;
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No saved reply';
    this.replySelectEl.appendChild(none);
    for (const r of replies) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.title;
      this.replySelectEl.appendChild(opt);
    }
  }

  /** Update custom tone presets (called when settings load/change). */
  setCustomTones(tones: CustomTone[]) {
    this.customTones = tones;
    this.buildChips();
    // Also offer them in the Write tab tone select.
    for (const opt of Array.from(this.writeToneEl.querySelectorAll('.custom-opt'))) opt.remove();
    for (const t of tones) {
      const opt = document.createElement('option');
      opt.className = 'custom-opt';
      opt.value = `custom:${t.id}`;
      opt.textContent = t.name;
      this.writeToneEl.appendChild(opt);
    }
  }

  selectTone(tone: ToneId) {
    for (const chip of this.chipsEl.querySelectorAll<HTMLButtonElement>('.chip')) {
      const active = chip.dataset.tone === tone;
      chip.classList.toggle('selected', active);
      chip.setAttribute('aria-pressed', String(active));
    }
  }

  // ---------- Body states (filled in by later phases) ----------

  showPlaceholder(text: string) {
    this.bodyEl.innerHTML = `<div class="placeholder">${escapeHtml(text)}</div>`;
    this.useButton.disabled = true;
    this.copyButton.disabled = true;
    this.generateButton.textContent = 'Generate';
    this.variants = [];
    this.selectedVariant = -1;
  }

  showHint(text: string) {
    this.bodyEl.innerHTML = `<div class="hint">${escapeHtml(text)}</div>`;
  }

  showLoading() {
    this.bodyEl.innerHTML = `
      <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
    this.useButton.disabled = true;
    this.copyButton.disabled = true;
  }

  showVariants(variants: Variant[], note?: string) {
    this.variants = variants;
    this.selectedVariant = variants.length > 0 ? 0 : -1;
    this.useButton.disabled = this.selectedVariant === -1;
    this.copyButton.disabled = this.selectedVariant === -1;
    this.generateButton.textContent = 'Regenerate';
    this.bodyEl.innerHTML = note
      ? `<div class="result-note">${escapeHtml(note)}</div>`
      : '';
    variants.forEach((v, i) => {
      const card = document.createElement('div');
      card.className = 'card' + (i === 0 ? ' selected' : '');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-pressed', String(i === 0));
      card.setAttribute('aria-label', `Variant ${i + 1}: ${v.label}`);
      card.innerHTML = `<div class="label">${escapeHtml(v.label)}</div><div class="text">${escapeHtml(v.text)}</div>`;
      const select = () => {
        this.selectedVariant = i;
        this.useButton.disabled = false;
        this.copyButton.disabled = false;
        for (const c of this.bodyEl.querySelectorAll('.card')) c.classList.remove('selected');
        card.classList.add('selected');
      };
      card.addEventListener('click', select);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select();
        }
      });
      this.bodyEl.appendChild(card);
    });
    this.scheduleUpdate();
  }

  showError(error: ApiError, actions?: { label: string; onClick: () => void }[]) {
    this.bodyEl.innerHTML = `<div class="error-box"><div class="msg">${escapeHtml(error.message)}</div></div>`;
    const box = this.bodyEl.querySelector('.error-box') as HTMLElement;
    for (const action of actions ?? []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      btn.addEventListener('click', action.onClick);
      box.appendChild(btn);
    }
    this.useButton.disabled = true;
    this.copyButton.disabled = true;
    this.generateButton.textContent = 'Generate';
  }

  // ---------- Write tab ----------

  private setTab(tab: 'rewrite' | 'write') {
    this.activeTab = tab;
    const rewritePage = this.panel.querySelector('#page-rewrite') as HTMLElement;
    const writePage = this.panel.querySelector('#page-write') as HTMLElement;
    rewritePage.hidden = tab !== 'rewrite';
    writePage.hidden = tab !== 'write';
    for (const btn of Array.from(this.panel.querySelectorAll<HTMLButtonElement>('.tab-btn'))) {
      const active = (btn.dataset.tab === 'write') === (tab === 'write');
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    this.scheduleUpdate();
  }

  private buildWriteRequest(): WriteGenerateRequest | null {
    const prompt = this.writePromptEl.value.trim();
    if (!prompt) {
      this.showWriteHint('Describe what the reply should say first.');
      return null;
    }
    const toneRaw = this.writeToneEl.value;
    let tone: ToneId | undefined;
    let customToneInstruction: string | undefined;
    if (toneRaw.startsWith('custom:')) {
      customToneInstruction = this.customTones.find(
        (t) => `custom:${t.id}` === toneRaw,
      )?.instruction;
    } else {
      tone = (toneRaw || undefined) as ToneId | undefined;
    }
    const length = (this.writeLenEl.value || undefined) as
      | 'short'
      | 'medium'
      | 'long'
      | undefined;
    const brief = this.callbacks.getWriteContext?.();
    const savedReply = this.savedReplies.find((r) => r.id === this.replySelectEl.value);
    return {
      prompt,
      tone,
      length,
      instruction: this.writeLastInstruction || undefined,
      brief,
      customToneInstruction,
      savedReply,
    };
  }

  /** Called by content when a follow-up instruction should revise drafts. */
  buildFollowUpRequest(instruction: string): WriteGenerateRequest | null {
    const draft = this.writeVariants[this.writeSelected];
    if (!draft) return null;
    this.writeLastInstruction = instruction;
    return {
      prompt: instruction,
      brief: this.callbacks.getWriteContext?.(),
      draft: draft.text,
    };
  }

  showWriteLoading() {
    this.writeBodyEl.innerHTML = `
      <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
    this.writeUseBtn.disabled = true;
    this.writeCopyBtn.disabled = true;
    this.writeCursorBtn.disabled = true;
  }

  showWriteHint(text: string) {
    this.writeBodyEl.innerHTML = `<div class="hint">${escapeHtml(text)}</div>`;
  }

  showWriteError(message: string) {
    this.writeBodyEl.innerHTML = `<div class="error-box"><div class="msg">${escapeHtml(message)}</div></div>`;
    this.writeUseBtn.disabled = true;
    this.writeCopyBtn.disabled = true;
    this.writeCursorBtn.disabled = true;
    this.writeGenBtn.textContent = 'Generate';
  }

  showWriteVariants(variants: Variant[]) {
    this.writeVariants = variants;
    this.writeSelected = variants.length > 0 ? 0 : -1;
    const has = this.writeSelected !== -1;
    this.writeUseBtn.disabled = !has;
    this.writeCopyBtn.disabled = !has;
    this.writeCursorBtn.disabled = !has;
    this.writeGenBtn.textContent = 'Regenerate';
    this.writeBodyEl.innerHTML = '';
    variants.forEach((v, i) => {
      const card = document.createElement('div');
      card.className = 'card' + (i === 0 ? ' selected' : '');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-pressed', String(i === 0));
      card.setAttribute('aria-label', `Variant ${i + 1}: ${v.label}`);
      card.innerHTML = `<div class="label">${escapeHtml(v.label)}</div><div class="text">${escapeHtml(v.text)}</div>`;
      const select = () => {
        this.writeSelected = i;
        this.writeUseBtn.disabled = false;
        this.writeCopyBtn.disabled = false;
        this.writeCursorBtn.disabled = false;
        for (const c of this.writeBodyEl.querySelectorAll('.card')) c.classList.remove('selected');
        card.classList.add('selected');
      };
      card.addEventListener('click', select);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select();
        }
      });
      this.writeBodyEl.appendChild(card);
    });
    this.scheduleUpdate();
  }

  // ---------- Positioning ----------

  private scheduleUpdate = () => {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.updatePosition();
    });
  };

  private updatePosition() {
    if (!this.anchor) return;
    const rect = this.anchor.getRect();
    const panelW = PANEL_WIDTH;

    const spaceBelow = window.innerHeight - rect.bottom - EDGE_GAP - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - EDGE_GAP - VIEWPORT_MARGIN;

    // Prefer below when it fits or has more room; otherwise above.
    // Whichever side we pick, the panel may shrink to fit the space.
    const placeBelow = spaceBelow >= spaceAbove;
    const avail = Math.max(placeBelow ? spaceBelow : spaceAbove, 0);

    // Measure the natural content height with the CSS max-height lifted,
    // so repeated updates don't ratchet the panel smaller over time.
    const prevMax = this.panel.style.maxHeight;
    this.panel.style.maxHeight = 'none';
    const naturalH = Math.min(this.panel.getBoundingClientRect().height, PANEL_MAX_HEIGHT);
    this.panel.style.maxHeight = prevMax;

    const allowedH = Math.max(Math.min(naturalH, avail), Math.min(160, avail));
    this.panel.style.maxHeight = `${Math.floor(allowedH)}px`;

    const panelH = Math.min(this.panel.getBoundingClientRect().height || allowedH, allowedH);

    let top = placeBelow ? rect.bottom + EDGE_GAP : rect.top - EDGE_GAP - panelH;
    let left = rect.right - panelW;
    if (left < VIEWPORT_MARGIN) left = rect.left;
    if (left + panelW > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - panelW - VIEWPORT_MARGIN;
    }
    top = Math.min(Math.max(top, VIEWPORT_MARGIN), window.innerHeight - panelH - VIEWPORT_MARGIN);
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - panelW - VIEWPORT_MARGIN);

    this.host.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
