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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
