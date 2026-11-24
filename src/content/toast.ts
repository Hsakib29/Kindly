// P3.6: small undo toast shown after "Use" inserts a variant.

import { themeCssVars, type ThemeMode } from '../shared/theme';

const LIGHT_VARS = themeCssVars('light');
const DARK_VARS = themeCssVars('dark');

const TOAST_MS = 8000;

export class UndoToast {
  private host: HTMLDivElement;
  private timer: number | undefined;

  constructor() {
    this.host = document.createElement('div');
    this.host.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483647;';
    const shadow = this.host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { color-scheme: light dark; }
        :host([data-theme='light']) { ${LIGHT_VARS} }
        :host([data-theme='dark']) { ${DARK_VARS} }
        .toast {
          display: flex;
          align-items: center;
          gap: 10px;
          background: var(--surface);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 8px 12px;
          font: 13px system-ui, sans-serif;
          box-shadow: 0 6px 24px var(--shadow);
        }
        button {
          border: none;
          background: var(--accent);
          color: var(--text-on-accent);
          border-radius: 6px;
          padding: 4px 10px;
          font: inherit;
          cursor: pointer;
        }
        button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
      </style>
      <div class="toast" role="status">
        <span>Rewritten</span>
        <button type="button">Undo</button>
      </div>
    `;
    (document.documentElement || document.body).appendChild(this.host);
    this.host.style.display = 'none';
    (shadow.querySelector('button') as HTMLButtonElement).addEventListener('click', () => {
      this.hide();
      this.onUndo?.();
    });
  }

  setTheme(mode: ThemeMode) {
    this.host.dataset.theme = mode;
    this.host.style.colorScheme = mode;
  }

  onUndo: (() => void) | null = null;

  show() {
    this.host.style.display = 'block';
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), TOAST_MS);
  }

  hide() {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.host.style.display = 'none';
  }

  destroy() {
    this.hide();
    this.host.remove();
  }
}
