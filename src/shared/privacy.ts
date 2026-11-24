// Centralized privacy sanitization (P-privacy).
//
// EVERY piece of webpage-derived context that can reach Gemini MUST pass
// through sanitizeText()/sanitizeBrief() — content side at build time,
// service worker again defensively before prompt construction. No
// adapter, extractor or code path may bypass this layer.
//
// Design goals: practical protection without wrecking customer-care
// context — descriptive markers preserve sentence structure, detection
// is category-counted, and nothing here logs or returns original values.

import type { ContextBriefData } from './messages';

export type RedactionCategory =
  | 'credentials-url'
  | 'jwt'
  | 'api-key'
  | 'email'
  | 'phone'
  | 'card'
  | 'iban'
  | 'ssn'
  | 'credential'
  | 'uuid'
  | 'token';

export type RedactionCounts = Partial<Record<RedactionCategory, number>>;

export interface SanitizeResult {
  text: string;
  counts: RedactionCounts;
  /** Total redactions applied. */
  total: number;
}

const MARKERS: Record<RedactionCategory, string> = {
  'credentials-url': '[credentials removed]',
  jwt: '[token removed]',
  'api-key': '[token removed]',
  email: '[email removed]',
  phone: '[phone number removed]',
  card: '[card number removed]',
  iban: '[account number removed]',
  ssn: '[id number removed]',
  credential: '[credential removed]',
  uuid: '[id removed]',
  token: '[token removed]',
};

interface Rule {
  category: RedactionCategory;
  re: RegExp;
  /** Optional checksum gate — return false to leave the match unchanged. */
  validate?: (match: string) => boolean;
}

// Luhn checksum (K-09): only card-shaped numbers that pass are masked,
// so order/tracking numbers survive.
function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

// IBAN mod-97 check (K-09): move first 4 chars to end, letters→numbers,
// result mod 97 must equal 1.
function ibanValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const code = ch >= '0' && ch <= '9' ? ch : String(ch.charCodeAt(0) - 55);
    for (const c of code) rem = (rem * 10 + (c.charCodeAt(0) - 48)) % 97;
  }
  return rem === 1;
}

// Order matters: specific formats first, generic long-token catch-all last.
// All regexes are global; applied sequentially so earlier rules' markers
// can't be re-matched by later ones (markers contain no token chars).
const RULES: Rule[] = [
  // user:password@ inside a URL
  {
    category: 'credentials-url',
    re: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/g,
  },
  // JSON Web Tokens (header.payload.signature, all base64url)
  {
    category: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  // Well-known API key / secret token formats
  {
    category: 'api-key',
    re: /\b(?:AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{16,}|sk_live_[0-9A-Za-z]{10,}|ghp_[0-9A-Za-z]{30,}|gho_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{30,}|xox[baprs]-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16}|ya29\.[0-9A-Za-z_-]{20,})\b/g,
  },
  // key: value / key=value credential patterns (password, token, secret…)
  {
    category: 'credential',
    re: /\b(?:password|passwd|pwd|pw|passphrase|pass|secret|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|session[_-]?token|cvv|cvc|ssn|social\s*security|passport|iban|account\s*(?:number|no|#)?|acct|routing|sort\s*code|ifsc|card\s*(?:number|no|#)?)\b\s*[:=]\s*[^\s,;"'`)\]}]+/gi,
  },
  // IBAN before card: spaced IBANs contain card-shaped digit runs.
  // Masked only when the mod-97 checksum passes (K-09).
  {
    category: 'iban',
    re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g,
    validate: (m) => ibanValid(m.replace(/ /g, '')),
  },
  // Credit-card-shaped numbers: 13–19 digits with optional space/dash
  // grouping, masked only when the Luhn checksum passes (K-09) — order
  // and tracking numbers that fail Luhn are left alone.
  {
    category: 'card',
    re: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (m) => {
      const digits = m.replace(/[ -]/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
    },
  },
  // US SSN shape
  {
    category: 'ssn',
    re: /\b\d{3}-\d{2}-\d{4}\b/g,
  },
  // Email addresses — masked (pre-existing behavior; K-09 did not
  // ask to remove it — customer-care threads routinely contain PII).
  {
    category: 'email',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  // Phone numbers — conservative: requires a +country prefix, or
  // parentheses/dot/dash separators in common groupings.
  {
    category: 'phone',
    re: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]\d{3,4}(?:[\s.-]\d{3,4})?\b|\+\d[\d\s().-]{7,}\d\b/g,
  },
  // UUIDs (any version)
  {
    category: 'uuid',
    re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
  },
  // Long opaque tokens (API keys, session ids, hashes). The lookbehind
  // keeps URL path segments and hyphenated words from matching.
  {
    category: 'token',
    re: /(?<![\w/.-])[A-Za-z0-9_-]{32,}(?![\w/.-])/g,
  },
];

/** Sanitize free text. Returns the cleaned text plus per-category counts. */
export function sanitizeText(text: string): SanitizeResult {
  if (!text) return { text, counts: {}, total: 0 };
  const counts: RedactionCounts = {};
  let total = 0;
  let out = text;

  for (const rule of RULES) {
    out = out.replace(rule.re, (match) => {
      if (rule.validate && !rule.validate(match)) return match;
      // For URL credentials keep the scheme+host visible is complex —
      // the whole "scheme://user:pass@" prefix becomes a marker.
      if (rule.category === 'credentials-url') {
        const scheme = match.includes('://') ? match.split('://')[0] + '://' : '';
        counts[rule.category] = (counts[rule.category] ?? 0) + 1;
        total++;
        return `${scheme}${MARKERS[rule.category]}@`;
      }
      counts[rule.category] = (counts[rule.category] ?? 0) + 1;
      total++;
      return MARKERS[rule.category];
    });
  }
  return { text: out, counts, total };
}

export interface SanitizedBrief {
  brief: ContextBriefData;
  counts: RedactionCounts;
  total: number;
}

const BRIEF_TEXT_FIELDS = ['title', 'replyTarget', 'otherParty', 'contextText'] as const;

/**
 * Sanitize every free-text field of a context brief. This is the single
 * architectural boundary for structured context — call it on the final
 * assembled brief so no adapter field can slip through raw.
 */
export function sanitizeBrief(brief: ContextBriefData): SanitizedBrief {
  const counts: RedactionCounts = {};
  let total = 0;
  const bump = (r: SanitizeResult) => {
    total += r.total;
    for (const [k, v] of Object.entries(r.counts)) {
      const key = k as RedactionCategory;
      counts[key] = (counts[key] ?? 0) + (v ?? 0);
    }
  };

  const out: ContextBriefData = { ...brief };
  for (const field of BRIEF_TEXT_FIELDS) {
    const value = out[field];
    if (typeof value === 'string' && value) {
      const r = sanitizeText(value);
      bump(r);
      (out as unknown as Record<string, unknown>)[field] = r.text;
    }
  }
  if (out.earlierMessages?.length) {
    out.earlierMessages = out.earlierMessages.map((m) => {
      const r = sanitizeText(m);
      bump(r);
      return r.text;
    });
  }
  return { brief: out, counts, total };
}

/** Merge two count maps (used when combining extraction + brief stats). */
export function mergeCounts(
  a: RedactionCounts,
  b: RedactionCounts,
): RedactionCounts {
  const out: RedactionCounts = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const key = k as RedactionCategory;
    out[key] = (out[key] ?? 0) + (v ?? 0);
  }
  return out;
}
