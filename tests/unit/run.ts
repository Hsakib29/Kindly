// Unit tests for pure modules (P8.6): prompts, quality checks, language
// detection. Run with `npm test` — bundles via esbuild like the eval.

import assert from 'node:assert/strict';
import { buildTaskPrompt, chooseMode, ROLE_LABELS } from '../../src/shared/prompts';
import { checkVariants } from '../../src/background/quality';
import { detectLanguage } from '../../src/shared/lang';
import type { ContextBriefData } from '../../src/shared/messages';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}: ${(err as Error).message}`);
  }
}

const brief: ContextBriefData = {
  platform: 'Gmail',
  title: 'Invoice question',
  replyTarget: 'Hi Sarah, when will order 123 ship? Thanks, Bob',
  otherParty: 'Bob Smith',
  replyLanguage: 'en',
};

// ---------- chooseMode ----------
test('chooseMode: <=8 words -> expand', () => {
  assert.equal(chooseMode({ draft: 'its fixed' }), 'expand');
  assert.equal(chooseMode({ draft: 'one two three four five six seven eight' }), 'expand');
});
test('chooseMode: >8 words -> polish', () => {
  assert.equal(
    chooseMode({ draft: 'one two three four five six seven eight nine ten' }),
    'polish',
  );
});
test('chooseMode: write always expand, revise always polish', () => {
  assert.equal(chooseMode({ draft: 'a much longer draft here yes indeed', isWrite: true }), 'expand');
  assert.equal(chooseMode({ draft: 'short', reviseDraft: 'long draft text' }), 'polish');
});

// ---------- buildTaskPrompt ----------
test('prompt has all sections in order', () => {
  const { userPrompt, mode } = buildTaskPrompt({ draft: 'hi', brief });
  const order = ['<context_brief>', '<reply_target', '<draft>', '<task>', '<examples>'];
  let pos = -1;
  for (const tag of order) {
    const i = userPrompt.indexOf(tag);
    assert.ok(i > pos, `${tag} missing or out of order`);
    pos = i;
  }
  assert.equal(mode, 'expand');
});
test('prompt includes reply target text and sender', () => {
  const { userPrompt } = buildTaskPrompt({ draft: 'hi', brief });
  assert.ok(userPrompt.includes('order 123 ship'));
  assert.ok(userPrompt.includes('Bob Smith'));
});
test('brand voice section emitted when configured', () => {
  const { userPrompt } = buildTaskPrompt({
    draft: 'hi',
    brandVoice: { greeting: 'Hey!', wordsToAvoid: ['synergy'] },
  });
  assert.ok(userPrompt.includes('<brand_voice>'));
  assert.ok(userPrompt.includes('Hey!'));
  assert.ok(userPrompt.includes('synergy'));
});
test('custom tone overrides tone description', () => {
  const { userPrompt } = buildTaskPrompt({
    draft: 'hi',
    tone: 'professional',
    customToneInstruction: 'always rhyme',
  });
  assert.ok(userPrompt.includes('always rhyme'));
  assert.ok(!userPrompt.includes('polished and courteous'));
});
test('saved reply emitted as approved_reply', () => {
  const { userPrompt } = buildTaskPrompt({
    draft: 'write a reply',
    isWrite: true,
    savedReply: { id: '1', title: 'Refund policy', text: 'Refunds take 5 days.' },
  });
  assert.ok(userPrompt.includes('<approved_reply'));
  assert.ok(userPrompt.includes('Refunds take 5 days.'));
});
test('instruction and avoid sections present', () => {
  const { userPrompt } = buildTaskPrompt({
    draft: 'hi',
    instruction: 'be brief',
    avoid: ['old variant one'],
  });
  assert.ok(userPrompt.includes('<instruction>'));
  assert.ok(userPrompt.includes('old variant one'));
});
test('no brief -> no context sections, still valid', () => {
  const { userPrompt } = buildTaskPrompt({ draft: 'hello there' });
  assert.ok(!userPrompt.includes('<reply_target'));
  assert.ok(!userPrompt.includes('<context_brief>'));
});

// ---------- checkVariants ----------
const goodVariants = [
  { label: 'a', text: 'Hi Bob, thanks for reaching out about order 123 — it ships tomorrow.', role: 'balanced' },
  { label: 'b', text: 'Hey Bob! Order 123 is on its way, expect it Thursday.', role: 'short' },
  { label: 'c', text: 'Dear Bob, regarding your shipping question for order 123, here are the details you need.', role: 'detailed' },
];

test('checkVariants passes good expand set', () => {
  const r = checkVariants(goodVariants, { draft: 'when does it ship', brief, mode: 'expand' });
  assert.equal(r.ok, true, r.failures.join('; '));
});
test('checkVariants flags draft echo', () => {
  const r = checkVariants(
    [{ label: 'a', text: 'when does it ship', role: 'short' }, ...goodVariants.slice(1)],
    { draft: 'when does it ship', brief, mode: 'expand' },
  );
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => f.includes('echo')));
});
test('checkVariants flags duplicates', () => {
  const dup = 'Hi Bob, order 123 ships tomorrow with tracking included for you.';
  const r = checkVariants(
    [
      { label: 'a', text: dup, role: 'balanced' },
      { label: 'b', text: dup, role: 'short' },
      { label: 'c', text: 'Totally different reply about something else entirely.', role: 'detailed' },
    ],
    { draft: 'x', brief, mode: 'expand' },
  );
  assert.equal(r.ok, false);
});
test('checkVariants flags AI-speak', () => {
  const r = checkVariants(
    [
      { label: 'a', text: 'As an AI, I cannot help with order 123 shipping questions.', role: 'short' },
      ...goodVariants.slice(1),
    ],
    { draft: 'x', brief, mode: 'expand' },
  );
  assert.ok(r.failures.some((f) => f.includes('AI')));
});
test('checkVariants requires target anchors', () => {
  const r = checkVariants(
    [
      { label: 'a', text: 'Sure, I will handle it right away for you today.', role: 'short' },
      { label: 'b', text: 'Consider it done, expect updates shortly.', role: 'balanced' },
      { label: 'c', text: 'Happy to assist with whatever you need next.', role: 'detailed' },
    ],
    { draft: 'x', brief, mode: 'expand' },
  );
  assert.ok(r.failures.some((f) => f.includes('reply target')));
});
test('checkVariants flags wrong language for ja target', () => {
  const r = checkVariants(goodVariants, {
    draft: 'x',
    brief: { ...brief, replyLanguage: 'ja' },
    mode: 'expand',
  });
  assert.ok(r.failures.some((f) => f.includes('language')));
});
test('checkVariants skipAnchor bypasses anchor requirement', () => {
  const r = checkVariants(
    [
      { label: 'a', text: 'Sure, I will handle it right away for you today.', role: 'short' },
      { label: 'b', text: 'Consider it done, expect updates shortly.', role: 'balanced' },
      { label: 'c', text: 'Happy to assist with whatever you need next.', role: 'detailed' },
    ],
    { draft: 'x', brief, mode: 'expand', skipAnchor: true },
  );
  assert.ok(!r.failures.some((f) => f.includes('reply target')));
});
test('polish mode tolerates close-to-draft variants', () => {
  const draft =
    'Hi Elena, thanks for reaching out. The Q3 roadmap has been updated and is now available in the shared drive under product planning.';
  const close =
    'Hi Elena, thanks for reaching out. The Q3 roadmap document has been updated and is now available in the shared drive under product planning.';
  const r = checkVariants(
    [
      { label: 'a', text: close, role: 'closest' },
      { label: 'b', text: 'Elena — the Q3 roadmap is updated and live in the shared drive.', role: 'concise' },
      { label: 'c', text: 'Hi Elena, thank you for your message. I wanted to share that the Q3 roadmap has been refreshed and can now be found in the product planning folder.', role: 'polished' },
    ],
    { draft, brief: { ...brief, replyTarget: 'Can you share the roadmap?' }, mode: 'polish' },
  );
  assert.equal(r.ok, true, r.failures.join('; '));
});

// ---------- detectLanguage ----------
test('detectLanguage: ja/bn/en', () => {
  assert.equal(detectLanguage('こんにちは、元気ですか'), 'ja');
  assert.equal(detectLanguage('আপনি কেমন আছেন'), 'bn');
  assert.equal(detectLanguage('hello world this is english'), 'en');
});

// ---------- ROLE_LABELS ----------
test('ROLE_LABELS covers all roles per mode', () => {
  assert.equal(ROLE_LABELS.expand.short, 'Short');
  assert.equal(ROLE_LABELS.polish.closest, 'Closest to your text');
  assert.equal(ROLE_LABELS.expand.detailed, 'Detailed');
});

// ---------- privacy.ts: sanitizeText ----------
import { sanitizeText, sanitizeBrief } from '../../src/shared/privacy';

test('privacy: credit card formats redacted', () => {
  for (const s of [
    'card 4111 1111 1111 1111 ok',
    'card 4111-1111-1111-1111 ok',
    'card 4111111111111111 ok',
  ]) {
    const r = sanitizeText(s);
    assert.ok(!r.text.includes('4111'), s);
    assert.ok(r.text.includes('[card number removed]'), s);
    assert.equal(r.counts.card, 1);
  }
});

test('privacy: emails redacted', () => {
  const r = sanitizeText('reach me at jane.doe+work@example.co.uk please');
  assert.ok(r.text.includes('[email removed]'));
  assert.ok(!r.text.includes('example.co.uk'));
  assert.equal(r.counts.email, 1);
});

test('privacy: phone numbers redacted (intl + common formats)', () => {
  for (const s of ['call +1 (415) 555-0132 now', 'call +44 20 7946 0958 now', 'call 415-555-0132 now']) {
    const r = sanitizeText(s);
    assert.ok(r.text.includes('[phone number removed]'), s);
    assert.ok(!/\d{3}[-. ]\d{3}[-. ]\d{4}/.test(r.text), s);
  }
});

test('privacy: JWT redacted', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const r = sanitizeText(`token is ${jwt} ok`);
  assert.ok(r.text.includes('[token removed]'));
  assert.ok(!r.text.includes('eyJhbGci'));
});

test('privacy: UUID redacted', () => {
  const r = sanitizeText('id 123e4567-e89b-42d3-a456-426614174000 end');
  assert.ok(r.text.includes('[id removed]'));
  assert.ok(!r.text.includes('123e4567'));
});

test('privacy: API key formats redacted', () => {
  const cases: [string, string][] = [
    ['AIzaSyD4iE2xVSpkLLOXoyq2jeDuiBVd2z5N1hQ', 'api-key'],
    ['sk-abcdefghijklmnopqrstuvwx1234', 'api-key'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'api-key'],
    ['AKIAIOSFODNN7EXAMPLE', 'api-key'],
  ];
  for (const [key, cat] of cases) {
    const r = sanitizeText(`key=${key} done`);
    assert.ok(!r.text.includes(key), key);
    assert.ok(r.counts[cat as keyof typeof r.counts]! >= 1, key);
  }
});

test('privacy: password/secret key-value patterns redacted', () => {
  const r = sanitizeText('login password: hunter2 and api_key=abc123xyz');
  assert.ok(r.text.includes('[credential removed]'));
  assert.ok(!r.text.includes('hunter2'));
  assert.ok(!r.text.includes('abc123xyz'));
});

test('privacy: credentials in URLs redacted, host kept', () => {
  const r = sanitizeText('see https://user:s3cretPass@example.com/path for details');
  assert.ok(!r.text.includes('s3cretPass'));
  assert.ok(r.text.includes('[credentials removed]@example.com'));
});

test('privacy: IBAN and SSN redacted', () => {
  const r = sanitizeText('iban GB29 NWBK 6016 1331 9268 19 ssn 078-05-1120');
  assert.ok(r.text.includes('[account number removed]'));
  assert.ok(r.text.includes('[id number removed]'));
});

test('privacy: false positives — innocent numbers/words survive', () => {
  const s = 'order 123456789 shipped on 2024-01-15, tracking 1Z999AA10123456784, total $49.99 for 3 items, ref ABC-12345';
  const r = sanitizeText(s);
  assert.equal(r.total, 0, `unexpected redactions: ${JSON.stringify(r.counts)}`);
  assert.equal(r.text, s);
});

test('privacy: multiple sensitive items all redacted', () => {
  const s = 'mail a@b.com or call +1 415-555-0132, card 4111 1111 1111 1111, pw: secret99';
  const r = sanitizeText(s);
  assert.ok(r.text.includes('[email removed]'));
  assert.ok(r.text.includes('[phone number removed]'));
  assert.ok(r.text.includes('[card number removed]'));
  assert.ok(r.text.includes('[credential removed]'));
  assert.ok(r.total >= 4);
});

test('privacy: clean conversation text unchanged', () => {
  const s = 'Hi Sarah, thanks for reaching out about order 12345. We will look into the delayed shipment and update you by Friday. Best, Support Team';
  const r = sanitizeText(s);
  assert.equal(r.text, s);
  assert.equal(r.total, 0);
});

test('privacy: empty and malformed input safe', () => {
  assert.deepEqual(sanitizeText(''), { text: '', counts: {}, total: 0 });
  assert.equal(sanitizeText('   ').total, 0);
  const r = sanitizeText('a'.repeat(500));
  assert.ok(r.text.length <= 500);
});

// ---------- privacy.ts: sanitizeBrief (structured boundary) ----------

test('privacy: sanitizeBrief covers every text field', () => {
  const dirty: ContextBriefData = {
    platform: 'Gmail',
    title: 'Re: invoice a@b.com',
    replyTarget: 'My card is 4111 1111 1111 1111, call +1 415-555-0132',
    otherParty: 'Jane jane@corp.io',
    replyLanguage: 'en',
    earlierMessages: ['bob: pw: hunter2', 'alice: hi there friend'],
    contextText: 'token sk-abcdefghijklmnopqrstuvwx1234 here',
  };
  const { brief, total } = sanitizeBrief(dirty);
  assert.ok(total >= 6, `expected >=6 redactions, got ${total}`);
  for (const f of ['title', 'replyTarget', 'otherParty', 'contextText'] as const) {
    assert.ok(!brief[f]!.includes('@'), `${f} still has raw email`);
  }
  assert.ok(!brief.replyTarget!.includes('4111'));
  assert.ok(!brief.earlierMessages![0].includes('hunter2'));
  assert.ok(brief.earlierMessages![1].includes('hi there friend'), 'clean message preserved');
});

test('privacy: sanitizeBrief leaves clean brief untouched', () => {
  const clean: ContextBriefData = {
    platform: 'Gmail',
    replyTarget: 'Hi, can you confirm the delivery date for order 12345?',
    earlierMessages: ['agent: certainly, checking now'],
  };
  const { brief, total } = sanitizeBrief(clean);
  assert.equal(total, 0);
  assert.equal(brief.replyTarget, clean.replyTarget);
});

console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
