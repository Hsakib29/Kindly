// Page context extraction for Write mode (P6.2/P6.3).
// Collects page title, URL, main content (boilerplate-stripped), and text
// near the active field. Cleans hidden elements/scripts, budgets the
// output, keeps the MOST RECENT text (chat tails matter most), and masks
// card-like numbers and long tokens before anything is sent to Gemini.

export interface PageContext {
  title: string;
  url: string;
  /** Cleaned main-content text, most-recent tail within budget. */
  mainText: string;
  /** Text from the field's surrounding container (conversation tail). */
  nearField: string;
}

const CONTEXT_BUDGET = 6000; // chars sent to Gemini
const NEAR_FIELD_BUDGET = 2000;

const BOILERPLATE_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'CANVAS',
  'NAV',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'FORM',
]);

function isHidden(el: Element): boolean {
  if (el instanceof HTMLElement) {
    if (el.hidden) return true;
    const style = el.style;
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  }
  return false;
}

/** Inner text of an element with boilerplate and hidden subtrees removed. */
function cleanText(root: Element | Document): string {
  const clone = root instanceof Document ? root.documentElement.cloneNode(true) : root.cloneNode(true);
  const walk = (node: Element | Document) => {
    for (const el of Array.from(node.querySelectorAll('*'))) {
      if (BOILERPLATE_TAGS.has(el.tagName) || isHidden(el)) {
        el.remove();
      } else {
        walk(el);
      }
    }
  };
  walk(clone as Element);
  return (clone as HTMLElement).innerText ?? clone.textContent ?? '';
}

/** Pick the most content-dense block as the "main" region. */
function pickMainRoot(doc: Document): Element {
  const candidates = Array.from(
    doc.querySelectorAll('main, article, [role="main"], #main, .main, .content, .thread, .conversation'),
  );
  let best: Element | null = null;
  let bestScore = 0;
  for (const el of candidates) {
    const text = el.textContent?.trim().length ?? 0;
    if (text > bestScore) {
      bestScore = text;
      best = el;
    }
  }
  return best ?? doc.body;
}

/** Text of the field's nearest meaningful ancestor (the conversation tail). */
function nearFieldText(field: HTMLElement): string {
  let el: HTMLElement | null = field.parentElement;
  for (let depth = 0; el && depth < 6; depth++) {
    const text = el.innerText?.trim() ?? '';
    // Stop at the first ancestor that looks like a conversation/thread or
    // has substantial text — that's the context that matters.
    if (text.length > 200 || /thread|conversation|message|comment/i.test(el.className)) {
      return text;
    }
    el = el.parentElement;
  }
  return '';
}

/** Keep the tail of `text` within `budget` chars (most recent content wins). */
function tailBudget(text: string, budget: number): string {
  const collapsed = text.replace(/\n{3,}/g, '\n\n').trim();
  if (collapsed.length <= budget) return collapsed;
  return '…' + collapsed.slice(collapsed.length - budget);
}

/** Mask card-like numbers and long opaque tokens before sending. */
export function maskSecrets(text: string): string {
  return (
    text
      // 13-19 digit card-like numbers (allow spaces/dashes between groups)
      .replace(/\b(?:\d[ -]?){13,19}\b/g, '[card number removed]')
      // long hex/base64-ish tokens (API keys, JWTs, session ids)
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[token removed]')
  );
}

/**
 * Extract page context for Write mode. A non-empty user text selection is
 * the PRIMARY context (the thing they're responding to).
 */
export function extractPageContext(field: HTMLElement): PageContext {
  const selection = window.getSelection();
  const selected = selection && !selection.isCollapsed ? selection.toString().trim() : '';

  const mainRoot = pickMainRoot(document);
  const mainText = cleanText(mainRoot);
  // The field's own ancestors may live outside <main>; merge near-field text.
  const near = nearFieldText(field);

  const title = document.title ?? '';
  const url = window.location.href;

  // Budget: selection first (it's the explicit context), then near-field,
  // then main text fills the remainder.
  let remaining = CONTEXT_BUDGET;
  const parts: string[] = [];

  const push = (label: string, text: string, budget: number) => {
    const trimmed = tailBudget(maskSecrets(text), Math.min(budget, remaining));
    if (trimmed) {
      parts.push(`--- ${label} ---\n${trimmed}`);
      remaining -= trimmed.length;
    }
  };

  if (selected) push('Selected text', selected, 2000);
  push('Near the text field', near, NEAR_FIELD_BUDGET);
  if (remaining > 200) push('Page content', mainText, remaining);

  return {
    title,
    url,
    mainText: parts.join('\n\n'),
    nearField: near,
  };
}
