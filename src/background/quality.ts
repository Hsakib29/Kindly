// Automatic quality checks for generated variants (Q4).
// Runs in the service worker — cheap string checks, no model calls.

import type { ContextBriefData, Variant } from '../shared/messages';
import { detectLanguage } from '../shared/lang';

export interface QualityCheckOptions {
  draft: string;
  brief?: ContextBriefData;
}

export interface QualityResult {
  ok: boolean;
  failures: string[];
}

const AI_SPEAK = /as an ai\b|as a language model|i'?m an ai\b|i am an ai\b/i;

// Rough per-role length bounds (chars).
const ROLE_MAX_CHARS: Record<string, number> = {
  short: 350,
  balanced: 900,
  detailed: 1400,
  closest: 900,
  concise: 700,
  polished: 1000,
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Word-overlap similarity in [0,1] — catches near-duplicates cheaply. */
function similarity(a: string, b: string): number {
  const wa = new Set(normalize(a).split(' ').filter(Boolean));
  const wb = new Set(normalize(b).split(' ').filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.min(wa.size, wb.size);
}

const STOPWORDS = new Set(
  ('the a an and or but if then else when at by for with about into through during before after ' +
    'above below to from up down in out on off over under again further once here there all any both ' +
    'each few more most other some such no nor not only own same so than too very can will just should now').split(' '),
);

/** Top content terms from the reply target, for anchor checks. */
function targetTerms(text: string): string[] {
  const words = normalize(text)
    .split(' ')
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  // Keep the 8 most frequent-ish (first occurrences, deduped).
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
      if (out.length >= 8) break;
    }
  }
  return out;
}

function containsAnchor(variantText: string, anchors: string[]): boolean {
  const v = variantText.toLowerCase();
  return anchors.some((a) => a && v.includes(a.toLowerCase()));
}

export function checkVariants(
  variants: Variant[],
  opts: QualityCheckOptions,
): QualityResult {
  const failures: string[] = [];
  const draftNorm = normalize(opts.draft);

  // 1. Echo / near-duplicate checks.
  let echoes = 0;
  let dupPairs = 0;
  for (const v of variants) {
    const vn = normalize(v.text);
    if (vn === draftNorm || similarity(v.text, opts.draft) > 0.9) echoes++;
  }
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      if (similarity(variants[i].text, variants[j].text) > 0.9) dupPairs++;
    }
  }
  if (echoes > 0) failures.push(`${echoes} variant(s) echo the draft`);
  if (dupPairs > 0) failures.push(`${dupPairs} near-duplicate pair(s)`);

  // 2. Length within role bounds.
  for (const v of variants) {
    const max = v.role ? ROLE_MAX_CHARS[v.role] : undefined;
    if (max && v.text.length > max) {
      failures.push(`"${v.role}" over ${max} chars`);
    }
  }

  // 3. Placeholder spam.
  for (const v of variants) {
    const placeholders = (v.text.match(/\[[^\]]{1,30}\]/g) ?? []).length;
    if (placeholders > 3) failures.push('placeholder spam');
    break; // one is enough to flag
  }

  // 4. AI-speak.
  if (variants.some((v) => AI_SPEAK.test(v.text))) failures.push('contains AI-disclaimer speak');

  // 4b. Language match: only flag confident mismatches (CJK/Bengali target
  // answered in plain English, etc.).
  const targetLang = opts.brief?.replyLanguage;
  if (targetLang && targetLang !== 'en') {
    const mismatched = variants.filter((v) => detectLanguage(v.text) === 'en').length;
    if (mismatched === variants.length) failures.push('wrong language for reply target');
  }

  // 5. Context anchoring: with a reply target, >=2 variants must reference it.
  const target = opts.brief?.replyTarget;
  if (target) {
    const anchors = [
      ...(opts.brief?.otherParty ? [opts.brief.otherParty.split(/\s+/)[0]] : []),
      ...targetTerms(target),
    ].filter(Boolean);
    const anchored = variants.filter((v) => containsAnchor(v.text, anchors)).length;
    if (anchored < 2) {
      failures.push(`only ${anchored}/3 variants reference the reply target`);
    }
  }

  return { ok: failures.length === 0, failures };
}
