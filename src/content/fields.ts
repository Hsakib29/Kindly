// P2.1: decide whether an element is a text field Kindly can help with.

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'email', 'tel']);

// Input types we never touch: credentials, payments, codes, pickers, buttons.
const REJECTED_INPUT_TYPES = new Set([
  'password',
  'hidden',
  'checkbox',
  'radio',
  'file',
  'submit',
  'button',
  'reset',
  'image',
  'range',
  'color',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

const MIN_WIDTH_PX = 60;
const MIN_HEIGHT_PX = 18;

function isContentEditable(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  const value = el.getAttribute('contenteditable');
  return value !== null && value !== 'false';
}

function hasRejectedAutocomplete(el: HTMLElement): boolean {
  const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase();
  return (
    ac.includes('current-password') ||
    ac.includes('new-password') ||
    ac.includes('one-time-code') ||
    ac.startsWith('cc-')
  );
}

function isTooSmall(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width < MIN_WIDTH_PX || rect.height < MIN_HEIGHT_PX;
}

/**
 * Returns true when `el` is a supported editable field:
 * textarea, text-like input, or contenteditable — and not password,
 * payment, one-time-code, hidden, tiny, or read-only.
 */
export function isSupportedField(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;

  const isField =
    el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || isContentEditable(el);
  if (!isField) return false;

  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    if (REJECTED_INPUT_TYPES.has(type)) return false;
    if (!TEXT_INPUT_TYPES.has(type)) return false;
  }

  if (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.readOnly : false) ||
    el.getAttribute('aria-readonly') === 'true' ||
    el.hasAttribute('readonly')
  ) {
    return false;
  }
  if (el.matches('[disabled], [aria-disabled="true"]')) return false;
  if (hasRejectedAutocomplete(el)) return false;
  if (isTooSmall(el)) return false;

  return true;
}

/** Deepest active element, piercing open shadow roots (P2.6 helper). */
export function getDeepActiveElement(root: Document | ShadowRoot = document): Element | null {
  let active = root.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}
