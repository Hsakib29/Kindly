// Site-specific context adapters (P6.8). Each adapter returns structured
// conversation context for tools whose DOM the generic extractor can't read.
// Selector lists live in one config object per site so they're easy to
// update when the site changes its markup — prefer stable hooks
// (role attributes, data-* ids) over obfuscated class names.

export interface AdapterMessage {
  from: string;
  date: string;
  body: string;
}

export interface SiteContext {
  /** Formatted context text ready to send to Gemini. */
  text: string;
  /** Exact number of messages/conversations found (0 = honest "none"). */
  messageCount: number;
  /** Adapter name for debug logs (e.g. 'gmail'). */
  extractor: string;
  /** Structured messages, oldest → newest (for the context brief). */
  messages?: AdapterMessage[];
  /** Thread/subject title when the site provides one. */
  subject?: string;
}

// ---------- Gmail ----------

const GMAIL = {
  // Message rows in an opened thread (.h7 is the stable-ish row hook).
  messageRow: ['.h7', 'div[role="listitem"]'],
  sender: ['.gD', '[email]'],
  date: ['.g3', 'span.g3'],
  body: ['.a3s', '.ii.gt'],
  subject: ['.hP', 'h2.hP'],
  // Quoted-reply / signature chrome inside bodies.
  quote: ['.gmail_quote', '.gmail_extra', '.ajz', 'blockquote.gmail_quote'],
  // New-compose fields (no thread).
  composeSubject: ['.aoT', 'input[name="subjectbox"]'],
  composeTo: ['.agP', 'input[name="to"]'],
  composeBody: ['.Am.aiL', '[contenteditable="true"][aria-label="Message Body"]'],
};

const MAX_MESSAGES = 50;
const MAX_BODY_CHARS = 3000;

function firstMatch(root: ParentNode, selectors: string[]): Element | null {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function allMatch(root: ParentNode, selectors: string[]): Element[] {
  for (const sel of selectors) {
    const els = Array.from(root.querySelectorAll(sel));
    if (els.length > 0) return els;
  }
  return [];
}

const NOISE_LINE =
  /unsubscribe|view in browser|view this email|privacy policy|all rights reserved|©\s*\d{4}|sent from my/i;

function cleanBody(body: Element): string {
  let text = (body.textContent ?? '').replace(/\s+/g, ' ').trim();
  const quoteAt = text.search(/\bOn .{5,120} wrote:|-----Original Message-----/);
  if (quoteAt > 0) text = text.slice(0, quoteAt).trim();
  // Drop noise lines (unsubscribe footers, tracking text, legal boilerplate).
  text = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => !NOISE_LINE.test(sentence))
    .join(' ')
    .trim();
  if (text.length > MAX_BODY_CHARS) text = text.slice(-MAX_BODY_CHARS); // keep tail = newest content
  return text;
}

function gmailAdapter(): SiteContext | null {
  const isGmail =
    window.location.hostname === 'mail.google.com' ||
    window.location.hostname.endsWith('.mail.google.com');
  if (!isGmail) return null;

  const subjectEl = firstMatch(document, GMAIL.subject);
  const subject = subjectEl?.textContent?.trim() ?? '';

  const rows = allMatch(document, GMAIL.messageRow)
    .filter((el) => el instanceof HTMLElement && el.offsetParent !== null)
    .slice(0, MAX_MESSAGES);

  if (rows.length === 0) {
    // New compose with no thread: subject + recipient fields if present.
    const sub = firstMatch(document, GMAIL.composeSubject) as HTMLInputElement | null;
    const to = firstMatch(document, GMAIL.composeTo) as HTMLInputElement | null;
    if (!sub && !to) return null;
    const lines = ['--- New message ---'];
    if (sub?.value) lines.push(`Subject: ${sub.value}`);
    if (to?.value) lines.push(`To: ${to.value}`);
    return { text: lines.join('\n'), messageCount: 0, extractor: 'gmail-compose' };
  }

  const messages: AdapterMessage[] = [];
  let collapsed = 0;
  for (const row of rows) {
    // Collapsed older messages render minimal text — count and skip bodies.
    const isCollapsed = row.querySelector('.kv, [aria-label*="Collapsed"]') !== null;
    const sender = firstMatch(row, GMAIL.sender)?.textContent?.trim() ?? '';
    const date = firstMatch(row, GMAIL.date)?.textContent?.trim() ?? '';
    const bodyEl = firstMatch(row, GMAIL.body);
    const body = bodyEl ? cleanBody(bodyEl) : '';
    if (isCollapsed && !body) {
      collapsed++;
      continue;
    }
    messages.push({ from: sender || 'unknown', date: date || 'unknown', body });
  }

  const header = subject ? `Subject: ${subject}` : '';
  const note = collapsed > 0 ? `(note: ${collapsed} older message(s) were collapsed)` : '';
  const text = [
    header,
    note,
    ...messages.map(
      (m, i) => `Message ${i + 1}\nFrom: ${m.from}\nDate: ${m.date}\n${m.body}`,
    ),
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    text,
    messageCount: messages.length,
    extractor: 'gmail',
    messages,
    subject: subject || undefined,
  };
}

// ---------- Registry ----------

export function trySiteAdapter(): SiteContext | null {
  return gmailAdapter();
}
