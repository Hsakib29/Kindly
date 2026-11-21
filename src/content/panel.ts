// P3.1: rewrite panel shell — Shadow DOM, anchored to the field,
// flips above/below based on available space, closes on Esc/outside click.

const PANEL_WIDTH = 340;
const PANEL_MAX_HEIGHT = 420;
const EDGE_GAP = 8;
const VIEWPORT_MARGIN = 8;

export interface PanelAnchor {
  getRect: () => DOMRect;
  /** Called when the panel closes so the field can reclaim focus. */
  onClose?: () => void;
}

export class RewritePanel {
  private host: HTMLDivElement;
  private panel: HTMLDivElement;
  private anchor: PanelAnchor | null = null;
  private rafId = 0;
  private onDocumentClick: ((e: Event) => void) | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
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
        }
        .body { padding: 10px; overflow-y: auto; flex: 1; }
        .placeholder { color: #9aa0ae; padding: 12px 4px; }
      </style>
      <div class="panel" role="dialog" aria-label="Kindly rewrite">
        <div class="body"><div class="placeholder">Kindly panel</div></div>
      </div>
    `;
    this.panel = shadow.querySelector('.panel') as HTMLDivElement;
    (document.documentElement || document.body).appendChild(this.host);
    this.host.style.display = 'none';
  }

  get isOpen(): boolean {
    return this.anchor !== null;
  }

  /** Open the panel anchored to a field. */
  open(anchor: PanelAnchor) {
    this.close();
    this.anchor = anchor;

    this.onDocumentClick = (e) => {
      const path = e.composedPath();
      if (!path.includes(this.host)) this.close();
    };
    // Capture phase so page handlers don't swallow it first.
    document.addEventListener('click', this.onDocumentClick, true);

    this.onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    this.host.addEventListener('keydown', this.onKeyDown, true);

    window.addEventListener('scroll', this.scheduleUpdate, { capture: true, passive: true });
    window.addEventListener('resize', this.scheduleUpdate, { passive: true });

    this.host.style.display = 'block';
    this.updatePosition();
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
    if (!this.anchor) return;
    const rect = this.anchor.getRect();
    const panelRect = this.panel.getBoundingClientRect();
    const panelH = Math.min(panelRect.height || PANEL_MAX_HEIGHT, PANEL_MAX_HEIGHT);
    const panelW = PANEL_WIDTH;

    const spaceBelow = window.innerHeight - rect.bottom - EDGE_GAP - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - EDGE_GAP - VIEWPORT_MARGIN;
    const placeBelow = spaceBelow >= panelH || spaceBelow >= spaceAbove;

    let top: number;
    let left: number;
    if (placeBelow) {
      top = rect.bottom + EDGE_GAP;
    } else {
      top = rect.top - EDGE_GAP - panelH;
    }

    // Align to the field's right edge; flip to left side near the viewport edge.
    left = rect.right - panelW;
    if (left < VIEWPORT_MARGIN) left = rect.left;
    if (left + panelW > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - panelW - VIEWPORT_MARGIN;
    }
    top = Math.min(Math.max(top, VIEWPORT_MARGIN), window.innerHeight - panelH - VIEWPORT_MARGIN);
    left = Math.min(Math.max(left, VIEWPORT_MARGIN), window.innerWidth - panelW - VIEWPORT_MARGIN);

    this.host.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
}
