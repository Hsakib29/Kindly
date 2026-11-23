// Field UI state machine — the single owner of icon/panel visibility.
//
// States:
//   idle          no supported field focused
//   waiting       supported field focused, typing pause not reached yet
//   icon          field ready — floating icon visible
//   panel         rewrite panel open (icon hidden while open)
//   hidden-site   site is on the user's hidden list (persisted)
//
// Transition table (event → from → to):
//   focusin supported field            *       → waiting | icon | hidden-site
//   typing input / pause timer         waiting → waiting | icon | panel(unchanged)
//   pause reached (ready / ready-empty) waiting|icon → icon | panel(unchanged)
//   icon click                         icon    → panel
//   panel closed (Esc/outside/Use)     panel   → icon | waiting | idle
//   focus leaves to unrelated element  *       → idle   (250ms grace)
//   field removed/re-rendered by page  *       → idle   (re-resolved on next focusin)
//   hide-on-this-site                  *       → hidden-site
//   storage change / sync()            hidden-site → recomputed
//   visibilitychange/focus/pageshow/   *       → resyncFromDom: re-resolve
//   1s consistency interval                    activeElement + re-evaluate
//                                              (no focusin fires on tab return)
//
// Icon visibility is DERIVED in sync() from (field valid && readiness ready
// && !siteHidden && !panelOpen) — never from one-shot events, so deduped or
// missed events can't leave the UI stuck hidden.

import { isSupportedField } from './fields';
import { KindlyIcon } from './icon';
import { RewritePanel } from './panel';
import { TypingTrigger, type FieldReadiness } from './typing-trigger';
import { readFieldText } from './inserter';

export type UiState = 'idle' | 'waiting' | 'icon' | 'panel' | 'hidden-site';

const BLUR_GRACE_MS = 250;

export interface FieldUiHooks {
  isSiteHidden: () => boolean;
  /** Called when the active field changes (for rewrite requests). */
  onFieldChange?: (field: HTMLElement | null) => void;
  /** Called whenever the panel closes — used to invalidate in-flight requests. */
  onPanelClosed?: () => void;
  /** Deep active element, piercing shadow roots. */
  getDeepActiveElement: () => Element | null;
}

export class FieldUiController {
  state: UiState = 'idle';

  private field: HTMLElement | null = null;
  private readiness: FieldReadiness = 'idle';
  private quiet = false;
  private panelOpenFlag = false;
  private suppressRefocus = false;
  private blurTimer: number | undefined;
  private disposed = false;

  readonly trigger: TypingTrigger;

  constructor(
    private icon: KindlyIcon,
    private panel: RewritePanel,
    private hooks: FieldUiHooks,
  ) {
    this.trigger = new TypingTrigger(({ field, state }) => {
      if (field !== this.field) return;
      this.readiness = state;
      this.quiet = state === 'ready-empty';
      this.sync();
    });
  }

  get activeField(): HTMLElement | null {
    return this.field;
  }

  /** focusin on a supported field. */
  focusField(el: HTMLElement) {
    window.clearTimeout(this.blurTimer);
    if (el === this.field && this.state !== 'idle') {
      // Same field re-focused (e.g. page re-render kept the node): just sync.
      this.sync();
      return;
    }
    // Switching fields while the panel is open: close it without letting
    // onClose steal focus back to the previous field.
    if (this.panel.isOpen) {
      this.suppressRefocus = true;
      this.panel.close();
      this.suppressRefocus = false;
    }
    this.field = el;
    this.readiness = 'idle';
    this.quiet = false;
    this.panelOpenFlag = false;
    this.hooks.onFieldChange?.(el);
    this.trigger.noteFocus(el);
    this.sync();
  }

  /** focusin on something that is NOT a supported field. */
  unfocusField() {
    this.field = null;
    this.readiness = 'idle';
    this.panelOpenFlag = false;
    this.hooks.onFieldChange?.(null);
    this.icon.hide();
    if (this.panel.isOpen) this.panel.close();
    this.state = 'idle';
  }

  /** input event inside the active field. */
  noteInput(el: HTMLElement) {
    if (el === this.field) this.trigger.noteInput(el);
  }

  /** focusout — schedule the grace-period recheck. */
  scheduleBlurCheck() {
    window.clearTimeout(this.blurTimer);
    this.blurTimer = window.setTimeout(() => {
      if (this.disposed) return;
      // While the panel is open the field may legitimately lose focus
      // (instruction box, etc.) — keep it.
      if (this.panelOpenFlag) return;
      const active = this.hooks.getDeepActiveElement();
      const stillField =
        active instanceof HTMLElement && active === this.field && isSupportedField(active);
      if (!stillField) {
        const hadField = this.field;
        this.field = null;
        this.readiness = 'idle';
        this.hooks.onFieldChange?.(null);
        this.icon.hide();
        if (hadField) this.trigger.noteBlur(hadField);
        this.state = 'idle';
      }
    }, BLUR_GRACE_MS);
  }

  /** Icon clicked — open the panel anchored to the icon's field. */
  openPanel() {
    const field = this.field;
    if (!field || !field.isConnected) {
      this.unfocusField();
      return;
    }
    this.panelOpenFlag = true;
    this.panel.open({
      getRect: () => field.getBoundingClientRect(),
      onClose: () => this.closePanel(),
    });
    this.sync();
  }

  /** Panel closed by any means — restore icon if the field is still ready. */
  closePanel() {
    this.panelOpenFlag = false;
    this.hooks.onPanelClosed?.();
    const field = this.field;
    if (field?.isConnected && !this.suppressRefocus) {
      field.focus();
      this.trigger.refresh(field);
    }
    this.sync();
  }

  /** User chose "Hide on this site" — persists via settings, sync derives state. */
  hideForSite() {
    this.sync();
  }

  /** Recompute after external changes (storage.onChanged, etc.). */
  resync() {
    this.sync();
  }

  /**
   * Re-resolve the active field from the DOM and re-run the visibility
   * rules. Called on visibilitychange/focus/pageshow/interval — no
   * focusin fires when a tab regains focus with the same field active,
   * so events alone can't recover the icon.
   */
  resyncFromDom() {
    if (this.disposed) return;
    const active = this.hooks.getDeepActiveElement();
    if (active instanceof HTMLElement && isSupportedField(active)) {
      if (active !== this.field || this.state === 'idle') {
        this.focusField(active);
      } else {
        // Same field, possibly stale readiness after a throttled timer.
        this.trigger.refresh(active);
        this.sync();
      }
      return;
    }
    // Active element isn't a supported field — if we still think we have
    // one and the panel isn't open, drop it (focus truly moved on).
    if (this.field && !this.panelOpenFlag) {
      const stillConnected = this.field.isConnected;
      const deep = this.hooks.getDeepActiveElement();
      if (!stillConnected || deep !== this.field) {
        // Only clear if the field really lost focus; blur check owns this
        // normally, but a throttled blur timer may not have run.
        this.scheduleBlurCheck();
      }
    }
  }

  fieldText(): string {
    return this.field ? readFieldText(this.field) : '';
  }

  dispose() {
    this.disposed = true;
    window.clearTimeout(this.blurTimer);
  }

  // ---------- Derived visibility ----------

  private sync() {
    if (this.disposed) return;
    const fieldOk =
      this.field != null && this.field.isConnected && isSupportedField(this.field);

    // Page re-rendered/removed the node — drop it; next focusin re-resolves.
    if (this.field && !this.field.isConnected) {
      const old = this.field;
      this.field = null;
      this.readiness = 'idle';
      this.panelOpenFlag = false;
      this.hooks.onFieldChange?.(null);
      this.trigger.noteBlur(old);
      this.icon.hide();
      if (this.panel.isOpen) this.panel.close();
      this.state = 'idle';
      return;
    }

    const siteHidden = this.hooks.isSiteHidden();
    const ready = this.readiness === 'ready' || this.readiness === 'ready-empty';
    const wantIcon = fieldOk && ready && !siteHidden && !this.panelOpenFlag;

    if (wantIcon && this.field) {
      this.icon.show(this.field, this.quiet);
      this.state = 'icon';
      return;
    }

    this.icon.hide();

    if (this.panelOpenFlag && fieldOk) {
      this.state = 'panel';
      return;
    }
    if (siteHidden) {
      this.state = 'hidden-site';
      return;
    }
    this.state = fieldOk ? 'waiting' : 'idle';
  }
}
