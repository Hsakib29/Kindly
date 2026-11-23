// P2.2/Q1: decide when a focused field is "ready" for the Kindly icon.
//
// Ready = user paused typing for PAUSE_MS, and either:
//   - the field has >= ICON_VISIBILITY.minWords words OR >= minChars chars, or
//   - the field is empty AND is a large writing area (quiet icon).
// Dropping below the threshold keeps the icon for belowThresholdGraceMs.

import { ICON_VISIBILITY } from './icon-visibility';

export const PAUSE_MS = 600;

export type FieldReadiness = 'idle' | 'typing' | 'ready' | 'ready-empty';

export interface ReadinessEvent {
  field: HTMLElement;
  state: FieldReadiness;
  /** Character count in the field when the event fired. */
  length: number;
}

function fieldText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  return el.textContent ?? '';
}

/** True for tall/multi-line writing areas — never for single-line inputs. */
function isLargeWritingArea(el: HTMLElement): boolean {
  try {
    if (el.getBoundingClientRect().height >= ICON_VISIBILITY.minEmptyFieldHeightPx) {
      return true;
    }
  } catch {
    /* detached node */
  }
  if (el instanceof HTMLTextAreaElement && el.rows > 1) return true;
  if (
    el.getAttribute('role') === 'textbox' &&
    el.getAttribute('aria-multiline') === 'true'
  ) {
    return true;
  }
  return false;
}

function wordCount(text: string): number {
  return text.length === 0 ? 0 : text.split(/\s+/).length;
}

export class TypingTrigger {
  private timers = new Map<HTMLElement, number>();
  private graceTimers = new Map<HTMLElement, number>();
  private states = new Map<HTMLElement, FieldReadiness>();

  constructor(private onChange: (event: ReadinessEvent) => void) {}

  private emit(field: HTMLElement, state: FieldReadiness) {
    const prev = this.states.get(field);
    if (prev === state) return;
    this.states.set(field, state);
    this.onChange({ field, state, length: fieldText(field).trim().length });
  }

  /** Call on every `input` event from a supported field. */
  noteInput(field: HTMLElement) {
    this.clearGrace(field);
    this.emit(field, 'typing');
    const existing = this.timers.get(field);
    if (existing !== undefined) window.clearTimeout(existing);
    this.timers.set(
      field,
      window.setTimeout(() => this.evaluate(field), PAUSE_MS),
    );
  }

  /** Call when a supported field gains focus. */
  noteFocus(field: HTMLElement) {
    this.evaluate(field);
  }

  /** Call when the field loses focus. */
  noteBlur(field: HTMLElement) {
    this.clearGrace(field);
    const timer = this.timers.get(field);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.timers.delete(field);
    }
    this.states.delete(field);
    this.emit(field, 'idle');
  }

  /** Force an immediate re-evaluation (e.g. after the panel closes). */
  refresh(field: HTMLElement) {
    this.evaluate(field);
  }

  private clearGrace(field: HTMLElement) {
    const t = this.graceTimers.get(field);
    if (t !== undefined) {
      window.clearTimeout(t);
      this.graceTimers.delete(field);
    }
  }

  private evaluate(field: HTMLElement) {
    this.timers.delete(field);
    const text = fieldText(field).trim();
    const len = text.length;
    const above =
      len > 0 && (wordCount(text) >= ICON_VISIBILITY.minWords || len >= ICON_VISIBILITY.minChars);

    if (above) {
      this.clearGrace(field);
      this.emit(field, 'ready');
      return;
    }

    if (len === 0) {
      this.clearGrace(field);
      this.emit(field, isLargeWritingArea(field) ? 'ready-empty' : 'typing');
      return;
    }

    // Below threshold but has some text: if we were showing the icon,
    // grace-period the hide so quick delete/retype doesn't flicker.
    const prev = this.states.get(field);
    if ((prev === 'ready' || prev === 'ready-empty') && !this.graceTimers.has(field)) {
      this.graceTimers.set(
        field,
        window.setTimeout(() => {
          this.graceTimers.delete(field);
          this.evaluate(field);
        }, ICON_VISIBILITY.belowThresholdGraceMs),
      );
      return;
    }
    this.emit(field, 'typing');
  }
}
