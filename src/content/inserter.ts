import { debugLog } from '../shared/debug';
// Text insertion into fields with a verification + fallback chain (P4.1)
// and a clipboard fallback (P4.2). Stage 4 hardened version.
//
// Method chain for inputs/textareas:
//   1. setRangeText (selection) / native value setter (whole field)
//   2. execCommand('insertText') with the field's contents selected
//   3. synthetic paste (ClipboardEvent with DataTransfer)
// For contenteditable:
//   1. execCommand('insertText')
//   2. beforeinput + Range insertion
//   3. synthetic paste
// If every method fails the text is copied to the clipboard and the
// caller shows "Copied. Press Ctrl+V to paste".

export interface FieldSelection {
  text: string;
  /** Character offsets, inputs/textareas only. */
  start?: number;
  end?: number;
  /** Live Range for contenteditable selections (may go stale if DOM changes). */
  range?: Range;
}

export type InsertResult =
  | { ok: true; method: string }
  | { ok: false; copiedToClipboard: boolean };

export function readFieldText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  // innerText preserves paragraph/line breaks that textContent drops (K-10).
  return el.innerText ?? el.textContent ?? '';
}

/** Strip all whitespace (incl. non-breaking spaces) for comparisons. */
export function stripWhitespace(s: string): string {
  return s.replace(/[\s\u00a0]+/g, '');
}

/** True when `inserted`'s first 20 chars appear in `field`, ignoring whitespace. */
export function sameTextIgnoringWhitespace(field: string, inserted: string): boolean {
  const needle = stripWhitespace(inserted).slice(0, 20);
  return needle.length > 0 && stripWhitespace(field).includes(needle);
}

/** Return the current selection inside `el`, or null if there is none. */
export function getFieldSelection(el: HTMLElement): FieldSelection | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start == null || end == null || start === end) return null;
    return { text: el.value.slice(start, end), start, end };
  }
  if (el.isContentEditable) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0).cloneRange();
    if (!el.contains(range.commonAncestorContainer)) return null;
    return { text: range.toString(), range };
  }
  return null;
}

function dispatchInput(el: HTMLElement) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function fieldContains(el: HTMLElement, text: string): boolean {
  return sameTextIgnoringWhitespace(readFieldText(el), text);
}

// ---------- Method 1: native value setter / setRangeText ----------

function tryNativeSetter(el: HTMLElement, text: string, selection?: FieldSelection): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    if (selection?.start != null && selection.end != null) {
      const original = el.value;
      el.setRangeText(text, selection.start, selection.end, 'end');
      dispatchInput(el);
      const expected =
        original.slice(0, selection.start) + text + original.slice(selection.end);
      if (el.value === expected) return true;
      // Frameworks may have rewritten value; fall through to full replace.
    }
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(el, text);
    dispatchInput(el);
    return el.value === text;
  }
  return false;
}

// ---------- Method 2: execCommand ----------

function tryExecCommand(el: HTMLElement, text: string, selection?: FieldSelection): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    if (selection?.start != null && selection.end != null) {
      el.setSelectionRange(selection.start, selection.end);
    } else {
      el.setSelectionRange(0, el.value.length);
    }
    const ok = document.execCommand('insertText', false, text);
    dispatchInput(el);
    return ok && fieldContains(el, text);
  }
  if (el.isContentEditable) {
    el.focus();
    const sel = window.getSelection();
    if (!sel) return false;
    if (selection) {
      // Restore the saved range so only the selection is replaced.
      if (selection.range && el.contains(selection.range.commonAncestorContainer)) {
        sel.removeAllRanges();
        sel.addRange(selection.range);
      }
    } else {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    const ok = document.execCommand('insertText', false, text);
    dispatchInput(el);
    return ok && fieldContains(el, text);
  }
  return false;
}

// ---------- Method 3: beforeinput + Range (contenteditable) ----------

function tryRangeInsert(el: HTMLElement, text: string, selection?: FieldSelection): boolean {
  if (!el.isContentEditable) return false;
  el.focus();
  const sel = window.getSelection();
  if (!sel) return false;

  let range: Range;
  if (selection?.range && el.contains(selection.range.commonAncestorContainer)) {
    range = selection.range;
  } else if (sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    range = sel.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(el);
  }
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  dispatchInput(el);
  return fieldContains(el, text);
}

// ---------- Method 4: synthetic paste ----------

function trySyntheticPaste(el: HTMLElement, text: string, selection?: FieldSelection): boolean {
  el.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', text);

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (selection?.start != null && selection.end != null) {
      el.setSelectionRange(selection.start, selection.end);
    } else {
      el.setSelectionRange(0, el.value.length);
    }
  } else if (el.isContentEditable && !selection) {
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  const paste = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dt,
  });
  el.dispatchEvent(paste);
  dispatchInput(el);
  return fieldContains(el, text);
}

// ---------- Clipboard fallback (P4.2) ----------

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for contexts where async clipboard is unavailable.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Insert text at the current caret/selection without replacing the
 * whole field (P6.7). Falls back to the clipboard on total failure.
 */
export async function insertAtCursor(
  el: HTMLElement,
  text: string,
): Promise<InsertResult> {
  el.focus();
  let ok = false;
  let method = 'none';

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? s;
    el.setRangeText(text, s, e, 'end');
    dispatchInput(el);
    ok = fieldContains(el, text);
    method = 'setRangeText';
    if (!ok) {
      ok = document.execCommand('insertText', false, text) && fieldContains(el, text);
      method = 'execCommand';
    }
  } else if (el.isContentEditable) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (el.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        dispatchInput(el);
        ok = fieldContains(el, text);
        method = 'range-insert';
      }
    }
    if (!ok) {
      ok = document.execCommand('insertText', false, text) && fieldContains(el, text);
      method = 'execCommand';
    }
  }

  if (ok) {
    debugLog(`cursor insert succeeded via ${method}`);
    return { ok: true, method };
  }
  const copiedToClipboard = await copyToClipboard(text);
  return { ok: false, copiedToClipboard };
}

/**
 * Replace the whole field's text (or just `selection` when given).
 * Each method is verified by reading the field back; on total failure
 * the text is copied to the clipboard.
 */
export async function insertText(
  el: HTMLElement,
  text: string,
  selection?: FieldSelection,
): Promise<InsertResult> {
  el.focus();

  const chain: [string, () => boolean][] = el.isContentEditable
    ? [
        ['execCommand', () => tryExecCommand(el, text, selection)],
        ['range-insert', () => tryRangeInsert(el, text, selection)],
        ['synthetic-paste', () => trySyntheticPaste(el, text, selection)],
      ]
    : [
        ['native-setter', () => tryNativeSetter(el, text, selection)],
        ['execCommand', () => tryExecCommand(el, text, selection)],
        ['synthetic-paste', () => trySyntheticPaste(el, text, selection)],
      ];

  for (const [name, attempt] of chain) {
    try {
      if (attempt()) {
        debugLog(`insert succeeded via ${name}`);
        return { ok: true, method: name };
      }
      debugLog(`insert method ${name} did not verify`);
    } catch (err) {
      debugLog(`insert method ${name} threw:`, err);
    }
  }

  const copiedToClipboard = await copyToClipboard(text);
  return { ok: false, copiedToClipboard };
}
