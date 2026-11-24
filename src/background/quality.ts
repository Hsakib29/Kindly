// Automatic quality checks for generated variants (Q4).
// Runs in the service worker — cheap string checks, no model calls.

import type { ContextBriefData, Variant } from '../shared/messages';
import { detectLanguage } from '../shared/lang';

export interface QualityCheckOptions {
  draft: string;
  brief?: ContextBriefData;
  /** 'polish' allows higher overlap — keeping meaning is the point. */
  mode?: 'expand' | 'polish';
  /** Skip the reply-target anchor check (eval injection cases). */
  skipAnchor?: boolean;
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

/**
 * Near-duplicate test: high word containment AND similar length.
 * Containment alone false-positives on short drafts ("I am interested"
 * is inside every expansion); length ratio alone misses true echoes.
 */
function isNearDuplicate(a: string, b: string, containment: number, maxRatio: number): boolean {
  const wa = new Set(normalize(a).split(' ').filter(Boolean));
  const wb = new Set(normalize(b).split(' ').filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const contain = inter / Math.min(wa.size, wb.size);
  const ratio = Math.max(wa.size, wb.size) / Math.min(wa.size, wb.size);
  return contain >= containment && ratio <= maxRatio;
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

/**
 * K-12: does this reply target need the anchor check? Space-separated
 * languages do; CJK/kana ('ja') and long unspaced text (Korean, Thai —
 * detectLanguage returns 'other' for them) cannot produce usable terms.
 */
export function needsAnchorCheck(target: string): boolean {
  if (detectLanguage(target) === 'ja') return false;
  if (!/\s/.test(target) && target.length > 20) return false;
  return true;
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

  // 1. Echo / near-duplicate checks. Polish mode legitimately reuses the
  // draft's wording, so thresholds are stricter there.
  const polish = opts.mode === 'polish';
  // Echo of the draft: strict for both modes (draft ≈ variant is never ok).
  const echoContain = 0.95;
  const echoRatio = 1.6;
  // Pair duplicates: roles legitimately share content words, so require
  // near-total containment AND similar length to call it a lazy duplicate.
  const pairContain = polish ? 0.97 : 0.93;
  const pairRatio = polish ? 1.4 : 1.5;
  let echoes = 0;
  let dupPairs = 0;
  for (const v of variants) {
    // 'closest' in polish mode is SUPPOSED to stay near the draft.
    if (polish && v.role === 'closest') continue;
    if (normalize(v.text) === draftNorm || isNearDuplicate(v.text, opts.draft, echoContain, echoRatio)) {
      echoes++;
    }
  }
  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      if (isNearDuplicate(variants[i].text, variants[j].text, pairContain, pairRatio)) dupPairs++;
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

  // 4b. Language match: only for confident non-Latin scripts (ja/bn).
  // 'other' covers es/fr/etc which detectLanguage can't distinguish from en.
  const targetLang = opts.brief?.replyLanguage;
  if (targetLang === 'ja' || targetLang === 'bn') {
    const mismatched = variants.filter((v) => detectLanguage(v.text) === 'en').length;
    if (mismatched === variants.length) failures.push('wrong language for reply target');
  }

  // 5. Context anchoring: with a reply target, >=2 variants must reference it.
  // K-12: skip for languages without word spaces — targetTerms() can't
  // split CJK/Korean/Thai text, so the whole target becomes one "term"
  // no variant will ever contain, causing spurious failures + retries.
  const target = opts.skipAnchor ? undefined : opts.brief?.replyTarget;
  if (target && needsAnchorCheck(target)) {
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
