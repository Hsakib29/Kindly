// P2.2: decide when a focused field is "ready" for the Kindly icon.
// Ready = user paused typing for PAUSE_MS, and the field is either empty
// (quiet style) or has at least MIN_LENGTH characters.

export const PAUSE_MS = 600;
export const MIN_LENGTH = 15;

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

export class TypingTrigger {
  private timers = new Map<HTMLElement, number>();
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
    this.emit(field, 'typing');
    const existing = this.timers.get(field);
    if (existing !== undefined) window.clearTimeout(existing);
    this.timers.set(
      field,
      window.setTimeout(() => this.evaluate(field), PAUSE_MS),
    );
  }

  /** Call when a supported field gains focus. Empty fields are ready immediately. */
  noteFocus(field: HTMLElement) {
    const len = fieldText(field).trim().length;
    if (len === 0) {
      this.evaluate(field, true);
    } else {
      this.emit(field, 'typing');
      this.noteInput(field);
    }
  }

  /** Call when the field loses focus. */
  noteBlur(field: HTMLElement) {
    const timer = this.timers.get(field);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.timers.delete(field);
    }
    this.states.delete(field);
    this.emit(field, 'idle');
  }

  private evaluate(field: HTMLElement, forceEmpty = false) {
    this.timers.delete(field);
    const len = fieldText(field).trim().length;
    if (forceEmpty || len === 0) {
      this.emit(field, 'ready-empty');
    } else if (len >= MIN_LENGTH) {
      this.emit(field, 'ready');
    } else {
      this.emit(field, 'typing');
    }
  }
}
