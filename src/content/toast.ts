// P3.6: small undo toast shown after "Use" inserts a variant.

const TOAST_MS = 8000;

export class UndoToast {
  private host: HTMLDivElement;
  private timer: number | undefined;

  constructor() {
    this.host = document.createElement('div');
    this.host.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483647;';
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .toast {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #1f2430;
          color: #e8eaf0;
          border: 1px solid #ffffff22;
          border-radius: 10px;
          padding: 8px 12px;
          font: 13px system-ui, sans-serif;
          box-shadow: 0 6px 24px rgba(0,0,0,0.4);
        }
        @media (prefers-color-scheme: light) {
          .toast { background: #fff; color: #1f2430; }
        }
        button {
          border: none;
          background: #4f7cff;
          color: #fff;
          border-radius: 6px;
          padding: 4px 10px;
          font: inherit;
          cursor: pointer;
        }
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
