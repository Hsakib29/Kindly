// P0.6/P0.7 insertion spike — temporary, replaced by the real inserter in Stage 4.
// Ctrl+Shift+K (Cmd+Shift+K on Mac) replaces the focused field's text.

import { isSupportedField } from './fields';

const SPIKE_TEXT = 'Kindly spike: text inserted by the extension.';

function getActiveField(): HTMLElement | null {
  const active = document.activeElement;
  if (!active || active === document.body) return null;
  return active as HTMLElement;
}

function isTextField(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return ['text', 'search', 'url', 'email', 'tel', ''].includes(el.type);
  }
  return el.isContentEditable;
}

/** Method A: native value setter + input/change events (P0.6). */
function insertNativeSetter(el: HTMLElement): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(el, SPIKE_TEXT);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (el.isContentEditable) {
    // Method B: execCommand insertText (P0.7) — preserves undo stack where supported.
    const ok = document.execCommand('insertText', false, SPIKE_TEXT);
    console.log('[Kindly] execCommand insertText ->', ok);
  }
}

/** Fallback: synthetic beforeinput / Range insertion for contenteditable. */
function insertBeforeInput(el: HTMLElement): boolean {
  if (!el.isContentEditable) return false;
  el.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', SPIKE_TEXT);
  const beforeInput = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertFromPaste',
    data: SPIKE_TEXT,
    dataTransfer: dt,
  });
  el.dispatchEvent(beforeInput);
  if (beforeInput.defaultPrevented) return false;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(SPIKE_TEXT);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }),
    );
    return true;
  }
  return false;
}

document.addEventListener('keydown', (event) => {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod || !event.shiftKey || event.key.toLowerCase() !== 'k') return;

  const el = getActiveField();
  if (!el || !isTextField(el) || !isSupportedField(el)) {
    console.warn('[Kindly] spike shortcut: no supported field focused');
    return;
  }
  event.preventDefault();
  el.focus();

  console.log('[Kindly] spike insert on', el);
  insertNativeSetter(el);
  const value =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.value
      : el.textContent;
  console.log('[Kindly] after native setter, field reads:', JSON.stringify(value));

  const inserted = typeof value === 'string' && value.includes(SPIKE_TEXT);
  if (!inserted) {
    console.log('[Kindly] native setter did not take — trying beforeinput fallback');
    console.log('[Kindly] beforeinput fallback ->', insertBeforeInput(el));
  }
});
