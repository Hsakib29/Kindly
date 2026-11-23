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
  /** Rough count of message-like blocks found (for the status chip). */
  messageCount: number;
  /** Debug stats — populated always, logged only when debug is on. */
  stats: {
    ms: number;
    visited: number;
    chars: number;
    trimmed: boolean;
    maskedCount: number;
    empty: boolean;
  };
}

const CONTEXT_BUDGET = 6000; // chars sent to Gemini
const NEAR_FIELD_BUDGET = 2000;

// Hard limits so extraction can never freeze the tab (it runs on the
// main thread inside the page).
const EXTRACT_TIME_BUDGET_MS = 150;
const EXTRACT_TEXT_CAP = 12000; // raw chars collected before tail-trim

const BOILERPLATE_SELECTOR =
  'script, style, noscript, template, svg, canvas, nav, header, footer, aside, form, [hidden], [aria-hidden="true"]';

// Block-level candidates that carry readable text. Much cheaper than
// walking every element: one querySelectorAll, then per-node cheap checks.
const TEXT_BLOCK_SELECTOR =
  'p, li, td, h1, h2, h3, h4, h5, h6, blockquote, pre, article, [role="article"], [class*="message"], [class*="msg-"], [class*="comment"], [class*="bubble"]';

function isInlineHidden(el: Element): boolean {
  if (el instanceof HTMLElement && el.style.display === 'none') return true;
  return false;
}

/**
 * Collect readable text blocks under `root`, skipping boilerplate and
 * hidden subtrees, within strict time/node/text budgets. Returns the
 * OLDEST-FIRST join; callers tail-budget it so recent content wins.
 */
interface CollectResult {
  text: string;
  visited: number;
  hitCap: boolean;
}

function collectText(root: Element, deadline: number): CollectResult {
  const blocks = root.querySelectorAll(TEXT_BLOCK_SELECTOR);
  const parts: string[] = [];
  let visited = 0;
  let chars = 0;
  let hitCap = false;

  for (const el of Array.from(blocks)) {
    visited++;
    if (Date.now() > deadline || chars > EXTRACT_TEXT_CAP) {
      hitCap = true;
      break;
    }
    // Skip anything inside boilerplate/hidden containers (one closest() call).
    if (el.closest(BOILERPLATE_SELECTOR) || isInlineHidden(el)) continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 2) continue;
    parts.push(text);
    chars += text.length;
  }
  return { text: parts.join('\n'), visited, hitCap };
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

/** Mask card-like numbers and long opaque tokens; returns masked count. */
export function maskSecrets(text: string): { text: string; masked: number } {
  let masked = 0;
  const cardRe = /\b(?:\d[ -]?){13,19}\b/g;
  const tokenRe = /\b[A-Za-z0-9_-]{32,}\b/g;
  const out = text
    // 13-19 digit card-like numbers (allow spaces/dashes between groups)
    .replace(cardRe, () => {
      masked++;
      return '[card number removed]';
    })
    // long hex/base64-ish tokens (API keys, JWTs, session ids)
    .replace(tokenRe, () => {
      masked++;
      return '[token removed]';
    });
  return { text: out, masked };
}

/**
 * Extract page context for Write mode. A non-empty user text selection is
 * the PRIMARY context (the thing they're responding to).
 */
export function extractPageContext(field: HTMLElement): PageContext {
  const started = performance.now();
  const selection = window.getSelection();
  const selected = selection && !selection.isCollapsed ? selection.toString().trim() : '';

  const deadline = Date.now() + EXTRACT_TIME_BUDGET_MS;
  const mainRoot = pickMainRoot(document);
  const collected = collectText(mainRoot, deadline);
  // The field's own ancestors may live outside <main>; merge near-field text.
  const near = nearFieldText(field);

  const title = document.title ?? '';
  const url = window.location.href;

  // Budget: selection first (it's the explicit context), then near-field,
  // then main text fills the remainder.
  let remaining = CONTEXT_BUDGET;
  const parts: string[] = [];
  let maskedCount = 0;
  let trimmed = false;

  const push = (label: string, text: string, budget: number) => {
    const masked = maskSecrets(text);
    maskedCount += masked.masked;
    const cap = Math.min(budget, remaining);
    if (masked.text.length > cap) trimmed = true;
    const trimmedText = tailBudget(masked.text, cap);
    if (trimmedText) {
      parts.push(`--- ${label} ---\n${trimmedText}`);
      remaining -= trimmedText.length;
    }
  };

  if (selected) push('Selected text', selected, 2000);
  push('Near the text field', near, NEAR_FIELD_BUDGET);
  if (remaining > 200) push('Page content', collected.text, remaining);
  if (collected.hitCap || collected.text.length > EXTRACT_TEXT_CAP) trimmed = true;

  // Rough message count for the "Read N messages" chip: article/comment/
  // message-like blocks on the page, capped for sanity.
  const messageCount = Math.min(
    document.querySelectorAll(
      'article, [role="article"], [class*="message"], [class*="msg-"], [class*="comment"], [class*="bubble"]',
    ).length,
    999,
  );

  const mainText = parts.join('\n\n');
  return {
    title,
    url,
    mainText,
    nearField: near,
    messageCount,
    stats: {
      ms: Math.round((performance.now() - started) * 10) / 10,
      visited: collected.visited,
      chars: mainText.length,
      trimmed,
      maskedCount,
      empty: mainText.trim().length === 0,
    },
  };
}
