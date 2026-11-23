// Rewrite panel: Shadow DOM UI anchored to the active field.
// Structure: tone chips, results body, extra-instruction row, action footer.

import { TONE_IDS, type ApiError, type ToneId, type Variant } from '../shared/messages';
import { PRODUCT_NAME } from '../shared/brand';

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
  context?: string;
  /** Existing draft to revise (follow-up instructions, P6.6). */
  draft?: string;
}

export interface PanelCallbacks {
  onTone?: (tone: ToneId) => void;
  onUse?: (variant: Variant) => void;
  onGenerate?: () => void;
  onInstruction?: (instruction: string) => void;
  onWriteGenerate?: (req: WriteGenerateRequest) => void;
  onWriteUse?: (variant: Variant, mode: 'replace' | 'cursor') => void;
  onWriteInstruction?: (instruction: string) => void;
  /** Returns the extracted page context to send (or undefined if none). */
  getWriteContext?: () => string | undefined;
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
  private ctxToggleEl!: HTMLInputElement;
  private ctxPreviewEl!: HTMLPreElement;
  private writeBodyEl!: HTMLElement;
  private writeInstrInput!: HTMLInputElement;
  private writeUseBtn!: HTMLButtonElement;
  private writeGenBtn!: HTMLButtonElement;
  private writeCopyBtn!: HTMLButtonElement;
  private writeCursorBtn!: HTMLButtonElement;
  private writeVariants: Variant[] = [];
  private writeSelected = -1;
  private writeLastInstruction = '';
  private onDocumentClick: ((e: Event) => void) | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private callbacks: PanelCallbacks = {};

  constructor(callbacks: PanelCallbacks = {}) {
    this.callbacks = callbacks;
    this.host = document.createElement('div');
    this.host.style.cssText =
      'position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none;';
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .panel {
          pointer-events: auto;
          width: ${PANEL_WIDTH}px;
          max-height: ${PANEL_MAX_HEIGHT}px;
          display: flex;
          flex-direction: column;
          background: #1f2430;
          color: #e8eaf0;
          border: 1px solid #ffffff22;
          border-radius: 12px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.45);
          font: 13px/1.4 system-ui, sans-serif;
          overflow: hidden;
        }
        @media (prefers-color-scheme: light) {
          .panel { background: #ffffff; color: #1f2430; border-color: #00000022; }
          .card { background: #f4f5f8; }
          .chip { background: #eef0f5; color: #1f2430; }
          .chip.selected { background: #4f7cff; color: #fff; }
          .instruction input { background: #f4f5f8; color: #1f2430; }
        }
        .header {
          padding: 8px 10px 4px;
          font-weight: 600;
          font-size: 12px;
          color: #9aa0ae;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 4px 10px 8px;
        }
        .chip {
          border: 1px solid #ffffff2e;
          background: #2a3040;
          color: #e8eaf0;
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 12px;
          cursor: pointer;
        }
        .chip:hover { border-color: #4f7cff; }
        .chip.selected { background: #4f7cff; border-color: #4f7cff; color: #fff; }
        .chip:focus-visible { outline: 2px solid #4f7cff; outline-offset: 1px; }
        .body { padding: 0 10px 10px; overflow-y: auto; flex: 1; min-height: 60px; }
        .placeholder, .hint { color: #9aa0ae; padding: 14px 4px; text-align: center; }
        .card {
          border: 1px solid #ffffff2e;
          border-radius: 10px;
          padding: 8px 10px;
          margin-bottom: 8px;
          cursor: pointer;
          background: #262c3b;
        }
        .card.selected { border-color: #4f7cff; box-shadow: 0 0 0 1px #4f7cff; }
        .card .label { font-size: 11px; color: #9aa0ae; margin-bottom: 2px; }
        .card .text {
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 140px;
          overflow-y: auto;
        }
        .instruction {
          display: flex;
          gap: 6px;
          padding: 8px 10px;
          border-top: 1px solid #ffffff14;
        }
        .instruction input {
          flex: 1;
          min-width: 0;
          border: 1px solid #ffffff2e;
          border-radius: 8px;
          background: #262c3b;
          color: inherit;
          padding: 6px 8px;
          font: inherit;
        }
        .instruction button, .actions button, .recent button {
          border: 1px solid #ffffff2e;
          background: #2a3040;
          color: inherit;
          border-radius: 8px;
          padding: 6px 10px;
          font: inherit;
          cursor: pointer;
        }
        .instruction button:hover, .actions button:hover { border-color: #4f7cff; }
        .actions {
          display: flex;
          gap: 8px;
          padding: 8px 10px;
          border-top: 1px solid #ffffff14;
        }
        .actions .primary {
          flex: 1;
          background: #4f7cff;
          border-color: #4f7cff;
          color: #fff;
          font-weight: 600;
        }
        .actions .primary:disabled { opacity: 0.45; cursor: default; }
        .recent {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 0 10px 8px;
        }
        .recent button {
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 999px;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .skeleton {
          height: 56px;
          border-radius: 10px;
          margin-bottom: 8px;
          background: linear-gradient(90deg, #2a3040 25%, #343b4d 50%, #2a3040 75%);
          background-size: 200% 100%;
          animation: shimmer 1.2s infinite;
        }
        @keyframes shimmer { to { background-position: -200% 0; } }
        .error-box { padding: 10px; font-size: 12px; }
        .error-box .msg { margin-bottom: 8px; }
        .model-tag {
          font-size: 10px;
          color: #9aa0ae;
          margin-left: auto;
          margin-right: 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 140px;
        }
        .header .close {
          border: none;
          background: transparent;
          color: inherit;
          font-size: 16px;
          line-height: 1;
          width: 30px;
          height: 30px;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }
        .header .close:hover { background: #ffffff1f; }
        @media (prefers-color-scheme: light) {
          .header .close:hover { background: #0000000f; }
        }
        .error-box button {
          border: 1px solid #ffffff2e;
          background: #2a3040;
          color: inherit;
          border-radius: 8px;
          padding: 4px 10px;
          font: inherit;
          cursor: pointer;
        }
        .tabs {
          display: flex;
          gap: 4px;
          padding: 6px 10px 0;
        }
        .tab-btn {
          border: none;
          background: transparent;
          color: #9aa0ae;
          font: inherit;
          font-weight: 600;
          font-size: 12px;
          padding: 5px 10px;
          border-radius: 8px 8px 0 0;
          cursor: pointer;
          border-bottom: 2px solid transparent;
        }
        .tab-btn.active { color: #e8eaf0; border-bottom-color: #4f7cff; }
        @media (prefers-color-scheme: light) {
          .tab-btn.active { color: #1f2430; }
        }
        .page {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          overflow: hidden;
        }
        .page[hidden] { display: none; }
        .write-form { padding: 8px 10px 4px; }
        .write-prompt {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #ffffff2e;
          border-radius: 8px;
          background: #262c3b;
          color: inherit;
          padding: 7px 9px;
          font: inherit;
          resize: vertical;
          min-height: 44px;
        }
        @media (prefers-color-scheme: light) {
          .write-prompt { background: #f4f5f8; color: #1f2430; }
          select { color-scheme: light; }
        }
        .write-controls {
          display: flex;
          gap: 6px;
          align-items: center;
          margin-top: 6px;
          flex-wrap: wrap;
        }
        .write-controls select {
          border: 1px solid #ffffff2e;
          border-radius: 8px;
          background: #2a3040;
          color: inherit;
          padding: 4px 6px;
          font: inherit;
          font-size: 12px;
        }
        .ctx-toggle {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: #9aa0ae;
          cursor: pointer;
          margin-left: auto;
        }
        .preview-btn {
          border: none;
          background: transparent;
          color: #4f7cff;
          font: inherit;
          font-size: 12px;
          padding: 4px 0;
          cursor: pointer;
          text-decoration: underline;
        }
        .ctx-preview {
          max-height: 140px;
          overflow-y: auto;
          background: #262c3b;
          border: 1px solid #ffffff14;
          border-radius: 8px;
          padding: 8px;
          font-size: 11px;
          white-space: pre-wrap;
          word-break: break-word;
          margin: 4px 0 0;
        }
        @media (prefers-color-scheme: light) {
          .ctx-preview { background: #f4f5f8; color: #1f2430; }
        }
        .write-body { padding: 0 10px 10px; }
        .write-instruction {
          display: flex;
          gap: 6px;
          padding: 6px 10px;
          border-top: 1px solid #ffffff14;
        }
        .write-instruction input {
          flex: 1;
          min-width: 0;
          border: 1px solid #ffffff2e;
          border-radius: 8px;
          background: #262c3b;
          color: inherit;
          padding: 6px 8px;
          font: inherit;
        }
        .write-instruction button {
          border: 1px solid #ffffff2e;
          background: #2a3040;
          color: inherit;
          border-radius: 8px;
          padding: 6px 10px;
          font: inherit;
          cursor: pointer;
        }
        .write-actions {
          display: flex;
          gap: 8px;
          padding: 8px 10px;
          border-top: 1px solid #ffffff14;
        }
        .write-actions .generate {
          border: 1px solid #ffffff2e;
          background: #2a3040;
          color: inherit;
          border-radius: 8px;
          padding: 6px 10px;
          font: inherit;
          cursor: pointer;
        }
        .write-actions .generate:hover { border-color: #4f7cff; }
        .write-actions .copy,
        .write-actions .cursor {
          border: 1px solid #ffffff2e;
          background: #2a3040;
          color: inherit;
          border-radius: 8px;
          padding: 6px 10px;
          font: inherit;
          cursor: pointer;
          white-space: nowrap;
        }
        .write-actions .primary {
          flex: 1;
          background: #4f7cff;
          border: 1px solid #4f7cff;
          color: #fff;
          border-radius: 8px;
          padding: 6px 10px;
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        .write-actions .primary:disabled,
        .write-actions .generate:disabled,
        .write-actions .copy:disabled,
        .write-actions .cursor:disabled { opacity: 0.45; cursor: default; }
      </style>
      <div class="panel" role="dialog" aria-label="Kindly">
        <div class="header"><span>${PRODUCT_NAME}</span><span class="model-tag"></span><button type="button" class="close" aria-label="Close">×</button></div>
        <div class="tabs" role="tablist">
          <button type="button" class="tab-btn active" data-tab="rewrite" role="tab" aria-selected="true">Rewrite</button>
          <button type="button" class="tab-btn" data-tab="write" role="tab" aria-selected="false">Write</button>
        </div>
        <div class="page" id="page-rewrite">
          <div class="chips" role="toolbar" aria-label="Tone"></div>
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
              <label class="ctx-toggle"><input type="checkbox" checked /> Page context</label>
            </div>
            <button type="button" class="preview-btn">Preview context</button>
            <pre class="ctx-preview" hidden></pre>
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

    // Keep focus in the field while interacting with panel controls
    // (except the instruction input, which needs real focus to type).
    shadow.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('input')) return;
      e.preventDefault();
    });

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
    this.ctxToggleEl = writePage.querySelector('.ctx-toggle input') as HTMLInputElement;
    this.ctxPreviewEl = writePage.querySelector('.ctx-preview') as HTMLPreElement;
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

    // Tab switching.
    for (const btn of Array.from(shadow.querySelectorAll<HTMLButtonElement>('.tab-btn'))) {
      btn.addEventListener('click', () => this.setTab(btn.dataset.tab === 'write' ? 'write' : 'rewrite'));
    }

    // Preview context shows EXACTLY what will be sent (P6.4).
    const previewBtn = writePage.querySelector('.preview-btn') as HTMLButtonElement;
    previewBtn.addEventListener('click', () => {
      const ctx = this.callbacks.getWriteContext?.();
      this.ctxPreviewEl.textContent = ctx?.trim()
        ? ctx
        : this.ctxToggleEl.checked
          ? '(no page context could be extracted)'
          : '(page context is turned off)';
      this.ctxPreviewEl.hidden = !this.ctxPreviewEl.hidden;
      previewBtn.textContent = this.ctxPreviewEl.hidden ? 'Preview context' : 'Hide context';
    });

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
    console.log('[Kindly] panel opened');
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

  showVariants(variants: Variant[]) {
    this.variants = variants;
    this.selectedVariant = variants.length > 0 ? 0 : -1;
    this.useButton.disabled = this.selectedVariant === -1;
    this.copyButton.disabled = this.selectedVariant === -1;
    this.generateButton.textContent = 'Regenerate';
    this.bodyEl.innerHTML = '';
    variants.forEach((v, i) => {
      const card = document.createElement('div');
      card.className = 'card' + (i === 0 ? ' selected' : '');
      card.tabIndex = 0;
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
    const tone = (this.writeToneEl.value || undefined) as ToneId | undefined;
    const length = (this.writeLenEl.value || undefined) as
      | 'short'
      | 'medium'
      | 'long'
      | undefined;
    const context = this.ctxToggleEl.checked ? this.callbacks.getWriteContext?.() : undefined;
    return { prompt, tone, length, instruction: this.writeLastInstruction || undefined, context };
  }

  /** Called by content when a follow-up instruction should revise drafts. */
  buildFollowUpRequest(instruction: string): WriteGenerateRequest | null {
    const draft = this.writeVariants[this.writeSelected];
    if (!draft) return null;
    this.writeLastInstruction = instruction;
    return {
      prompt: instruction,
      context: this.ctxToggleEl.checked ? this.callbacks.getWriteContext?.() : undefined,
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
