// P2.3/P2.4: floating Kindly icon in an isolated Shadow DOM, anchored to
// the bottom-right of the active field and tracking it on scroll/resize/growth.

const ICON_SIZE = 32;
const EDGE_INSET = 6;
const VIEWPORT_MARGIN = 8;

const ICON_SVG = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
     xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M12 21s-7.5-4.9-9.7-9.2C.9 8.9 2.4 5 6 5c2 0 3.4 1.1 4.2 2.4h3.6C14.6 6.1 16 5 18 5c3.6 0 5.1 3.9 3.7 6.8C19.5 16.1 12 21 12 21z"
        fill="currentColor" opacity="0.9"/>
  <circle cx="9" cy="10.5" r="1.4" fill="#fff"/>
  <circle cx="15" cy="10.5" r="1.4" fill="#fff"/>
</svg>`;

export class KindlyIcon {
  private host: HTMLDivElement;
  private button: HTMLButtonElement;
  private field: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafId = 0;

  constructor(
    private onClick: () => void,
    private onHideSite: () => void,
  ) {
    this.host = document.createElement('div');
    this.host.style.cssText =
      'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;';
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        button {
          pointer-events: auto;
          width: ${ICON_SIZE}px;
          height: ${ICON_SIZE}px;
          border: none;
          border-radius: 50%;
          background: #4f7cff;
          color: #fff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.35);
          opacity: 0.95;
          transition: opacity 0.15s, transform 0.1s;
          padding: 0;
        }
        button:hover { opacity: 1; transform: scale(1.08); }
        button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        .quiet { opacity: 0.55; }
      </style>
      <button type="button" aria-label="Open Kindly" title="Kindly">${ICON_SVG}</button>
    `;
    this.button = shadow.querySelector('button') as HTMLButtonElement;
    this.button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onClick();
    });
    this.button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onHideSite();
    });
    (document.documentElement || document.body).appendChild(this.host);

    window.addEventListener('scroll', this.scheduleUpdate, { capture: true, passive: true });
    window.addEventListener('resize', this.scheduleUpdate, { passive: true });
  }

  /** Show the icon anchored to the field's bottom-right corner. */
  show(field: HTMLElement, quiet = false) {
    this.field = field;
    this.button.classList.toggle('quiet', quiet);
    this.host.style.display = 'block';
    if (this.resizeObserver && this.field) this.resizeObserver.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.scheduleUpdate());
    this.resizeObserver.observe(field);
    this.updatePosition();
  }

  setQuiet(quiet: boolean) {
    this.button.classList.toggle('quiet', quiet);
  }

  hide() {
    this.host.style.display = 'none';
    this.field = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  destroy() {
    window.removeEventListener('scroll', this.scheduleUpdate, { capture: true });
    window.removeEventListener('resize', this.scheduleUpdate);
    this.resizeObserver?.disconnect();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.host.remove();
  }

  private scheduleUpdate = () => {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.updatePosition();
    });
  };

  private updatePosition() {
    if (!this.field || !this.field.isConnected) {
      this.hide();
      return;
    }
    const rect = this.field.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.hide();
      return;
    }

    // Bottom-right corner, inside the field when there's room.
    let left = rect.right - ICON_SIZE - EDGE_INSET;
    let top = rect.bottom - ICON_SIZE - EDGE_INSET;

    // If the field is shorter than the icon, center it vertically instead.
    if (rect.height < ICON_SIZE + EDGE_INSET * 2) {
      top = rect.top + rect.height / 2 - ICON_SIZE / 2;
    }

    // Keep inside the viewport.
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - ICON_SIZE - VIEWPORT_MARGIN);
    top = Math.min(Math.max(top, VIEWPORT_MARGIN), window.innerHeight - ICON_SIZE - VIEWPORT_MARGIN);

    this.host.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
}
