// Page context extraction for Write mode (P6.2/P6.3).
// Collects page title, URL, main content (boilerplate-stripped), and text
// near the active field. Cleans hidden elements/scripts, budgets the
// output, keeps the MOST RECENT text (chat tails matter most), and masks
// card-like numbers and long tokens before anything is sent to Gemini.

import { pickReplyTargetIndex, trySiteAdapter } from './site-adapters';
import { detectLanguage } from '../shared/lang';
import { sanitizeText, sanitizeBrief } from '../shared/privacy';
import type { ContextBriefData } from '../shared/messages';

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
  /** Which extractor produced the text: 'gmail', 'generic', etc. */
  extractor: string;
}

const CONTEXT_BUDGET = 6000; // chars sent to Gemini
const NEAR_FIELD_BUDGET = 2000;

// Hard limits so extraction can never freeze the tab (it runs on the
// main thread inside the page). Sized to read a normal email thread.
const EXTRACT_TIME_BUDGET_MS = 250;
const EXTRACT_TEXT_CAP = 20000; // raw chars collected before tail-trim
const GENERIC_MIN_CHARS = 300; // below this, try the largest-container fallback

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

/** Largest text-bearing container — fallback when block selectors miss. */
function pickLargestTextContainer(doc: Document, deadline: number): Element | null {
  const candidates = Array.from(
    doc.querySelectorAll('main, article, [role="main"], div, section'),
  );
  let best: Element | null = null;
  let bestLen = 0;
  const limit = Math.min(candidates.length, 600);
  for (let i = 0; i < limit; i++) {
    if (Date.now() > deadline) break;
    const el = candidates[i];
    if (el.closest(BOILERPLATE_SELECTOR)) continue;
    const len = el.textContent?.length ?? 0;
    if (len > bestLen) {
      bestLen = len;
      best = el;
    }
  }
  return best;
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

/**
 * Extract page context for Write mode. A non-empty user text selection is
 * the PRIMARY context (the thing they're responding to).
 */
export function extractPageContext(field: HTMLElement): PageContext {
  const started = performance.now();
  const title = document.title ?? '';
  const url = window.location.href;

  // Site adapters first — they understand the tool's real structure.
  const adapted = trySiteAdapter();
  if (adapted && adapted.text.trim()) {
    const masked = sanitizeText(adapted.text);
    const mainText = tailBudget(masked.text, CONTEXT_BUDGET);
    return {
      title,
      url,
      mainText,
      nearField: '',
      messageCount: adapted.messageCount,
      extractor: adapted.extractor,
      stats: {
        ms: Math.round((performance.now() - started) * 10) / 10,
        visited: adapted.messageCount * 4,
        chars: mainText.length,
        trimmed: masked.text.length > CONTEXT_BUDGET,
        maskedCount: masked.total,
        empty: mainText.trim().length === 0,
      },
    };
  }

  const selection = window.getSelection();
  const selected = selection && !selection.isCollapsed ? selection.toString().trim() : '';

  const deadline = Date.now() + EXTRACT_TIME_BUDGET_MS;
  const mainRoot = pickMainRoot(document);
  let collected = collectText(mainRoot, deadline);

  // Generic fallback: if the block pass found almost nothing, the page's
  // text probably lives in plain <div>s — find the largest text container
  // and collect inside it with whatever budget remains.
  if (collected.text.trim().length < GENERIC_MIN_CHARS && Date.now() < deadline) {
    const biggest = pickLargestTextContainer(document, deadline);
    if (biggest && biggest !== mainRoot) {
      const more = collectText(biggest, deadline);
      if (more.text.length > collected.text.length) collected = more;
    }
  }
  // The field's own ancestors may live outside <main>; merge near-field text.
  const near = nearFieldText(field);

  // Budget: selection first (it's the explicit context), then near-field,
  // then main text fills the remainder.
  let remaining = CONTEXT_BUDGET;
  const parts: string[] = [];
  let maskedCount = 0;
  let trimmed = false;

  const push = (label: string, text: string, budget: number) => {
    const masked = sanitizeText(text);
    maskedCount += masked.total;
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
    extractor: 'generic',
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

// ---------- Context brief (Q2) ----------
// A structured summary built in code — the model never has to figure out
// what it's replying to.

const REPLY_TARGET_CAP = 1500;
const EARLIER_MESSAGE_CAP = 400;
const EARLIER_MESSAGE_COUNT = 4;

function platformName(): string {
  const h = window.location.hostname;
  if (h.includes('mail.google')) return 'Gmail';
  if (h.includes('chatgpt') || h.includes('openai')) return 'ChatGPT';
  if (h.includes('grok') || h.includes('x.com')) return 'Grok';
  return 'web';
}

function capKeepEnd(text: string, cap: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= cap ? t : '…' + t.slice(t.length - cap);
}

export interface BuiltBrief {
  brief: ContextBriefData;
  messageCount: number;
  extractor: string;
  /** Sensitive items redacted by the privacy layer (metadata only). */
  maskedCount: number;
}

/**
 * Build the structured context brief. With a site adapter that returns
 * messages, reply_target = latest message (the one being replied to) and
 * earlier_messages = the few turns before it. Generic pages fall back to
 * the tail of the extracted text.
 */
export function buildContextBrief(field: HTMLElement, draftText = ''): BuiltBrief {
  const adapted = trySiteAdapter();

  if (adapted?.messages && adapted.messages.length > 0) {
    const msgs = adapted.messages;
    // K-14: reply to the last message NOT sent by the user; user's own
    // messages still appear in context labelled "Me".
    const targetIdx = pickReplyTargetIndex(msgs);
    const target = targetIdx >= 0 ? msgs[targetIdx] : undefined;
    const replyTarget = target ? capKeepEnd(target.body, REPLY_TARGET_CAP) : undefined;
    const label = (m: (typeof msgs)[number]) => (m.isFromUser ? 'Me' : m.from);
    const earlier = msgs
      .filter((_, i) => i !== targetIdx)
      .slice(-EARLIER_MESSAGE_COUNT)
      .map((m) => `${label(m)}: ${capKeepEnd(m.body, EARLIER_MESSAGE_CAP)}`);
    // Privacy boundary: sanitize the ASSEMBLED brief — adapter messages,
    // subject and context text all pass through the same layer regardless
    // of which extractor produced them.
    const { brief, total } = sanitizeBrief({
      platform: platformName(),
      title: adapted.subject,
      replyTarget,
      otherParty: target && target.from !== 'unknown' ? target.from : undefined,
      replyLanguage: replyTarget ? detectLanguage(replyTarget) : undefined,
      draftLanguage: detectLanguage(draftText),
      earlierMessages: earlier.length ? earlier : undefined,
      contextText: adapted.text || undefined,
    });
    return {
      brief,
      messageCount: msgs.length,
      extractor: adapted.extractor,
      maskedCount: total,
    };
  }

  // Generic path: tail of extracted text is the reply target.
  const pc = extractPageContext(field);
  const text = pc.mainText.trim();
  if (!text) {
    return {
      brief: {
        platform: platformName(),
        replyLanguage: undefined,
        draftLanguage: detectLanguage(draftText) || undefined,
      },
      messageCount: 0,
      extractor: pc.extractor,
      maskedCount: 0,
    };
  }
  const replyTarget = capKeepEnd(text, REPLY_TARGET_CAP);
  const before = text.slice(0, Math.max(0, text.length - REPLY_TARGET_CAP));
  const earlier = before
    ? [capKeepEnd(before.slice(-EARLIER_MESSAGE_CAP * EARLIER_MESSAGE_COUNT), EARLIER_MESSAGE_CAP * EARLIER_MESSAGE_COUNT)]
    : [];
  const { brief, total } = sanitizeBrief({
    platform: platformName(),
    title: pc.title || undefined,
    replyTarget,
    replyLanguage: detectLanguage(replyTarget),
    draftLanguage: detectLanguage(draftText) || undefined,
    earlierMessages: earlier.length ? earlier : undefined,
    contextText: text,
  });
  return {
    brief,
    messageCount: pc.messageCount,
    extractor: pc.extractor,
    maskedCount: total,
  };
}
