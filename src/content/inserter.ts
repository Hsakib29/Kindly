// Text insertion into fields. Stage 3 version: replace whole field or a
// selection range, with a fallback chain and read-back verification.
// Stage 4 (P4.x) hardens this further.

export interface FieldSelection {
  text: string;
  /** Character offsets, inputs/textareas only. */
  start?: number;
  end?: number;
  /** Live Range for contenteditable selections (may go stale if DOM changes). */
  range?: Range;
}

export function readFieldText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  return el.textContent ?? '';
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

function nativeSetterInsert(el: HTMLElement, text: string): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
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

/** Replace the entire contents of a contenteditable via execCommand. */
function execCommandReplaceAll(el: HTMLElement, text: string): boolean {
  if (!el.isContentEditable) return false;
  el.focus();
  const sel = window.getSelection();
  if (!sel) return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
  const ok = document.execCommand('insertText', false, text);
  dispatchInput(el);
  return ok && (el.textContent ?? '').includes(text.slice(0, 20));
}

/** contenteditable fallback: delete contents of `range` (or selection) and insert a text node. */
function rangeInsert(el: HTMLElement, text: string, savedRange?: Range): boolean {
  if (!el.isContentEditable) return false;
  el.focus();
  const sel = window.getSelection();
  if (!sel) return false;

  let range: Range;
  if (savedRange && el.contains(savedRange.commonAncestorContainer)) {
    range = savedRange;
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
  return (el.textContent ?? '').includes(text.slice(0, 20));
}

/**
 * Replace the whole field's text (or just `selection` when given).
 * Tries each method in order and verifies by reading the field back.
 */
export function replaceFieldText(
  el: HTMLElement,
  text: string,
  selection?: FieldSelection,
): boolean {
  el.focus();

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (selection?.start != null && selection.end != null) {
      const original = el.value;
      el.setRangeText(text, selection.start, selection.end, 'end');
      dispatchInput(el);
      const expected = original.slice(0, selection.start) + text + original.slice(selection.end);
      if (el.value === expected) return true;
    }
    if (nativeSetterInsert(el, text)) return true;
    return false;
  }

  if (el.isContentEditable) {
    if (selection) {
      if (rangeInsert(el, text, selection.range)) return true;
    } else {
      if (execCommandReplaceAll(el, text)) return true;
      if (rangeInsert(el, text)) return true;
    }
  }
  return false;
}
