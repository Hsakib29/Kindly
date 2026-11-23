// Eval harness (Q6): runs cases.json through the same prompt + generation
// + quality pipeline as the extension, on a lite model, and prints a
// pass/fail table. Dev only — reads the key from key.txt, never bundled
// into dist/.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTaskPrompt } from '../../src/shared/prompts';
import { generateVariants, GeminiError } from '../../src/background/gemini';
import { checkVariants } from '../../src/background/quality';
import { detectLanguage } from '../../src/shared/lang';
import type { ContextBriefData, ToneId } from '../../src/shared/messages';

// Paths resolve from the repo root (cwd) — the bundle lives in .build/.
const root = process.cwd();
const casesPath = resolve(root, 'tests', 'eval', 'cases.json');

interface EvalCase {
  id: string;
  description: string;
  isWrite?: boolean;
  brief?: ContextBriefData;
  draft: string;
  tone?: ToneId;
  expected?: {
    mode?: string;
    mentions?: string[];
    language?: string;
    forbiddenClaims?: string[];
    skipAnchor?: boolean;
  };
}

const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as EvalCase[];
const key = readFileSync(resolve(root, 'key.txt'), 'utf8').trim();
const MODEL = 'gemini-3.5-flash-lite';
const DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function caseChecks(c: EvalCase, variants: { text: string }[], mode: string): string[] {
  const fails: string[] = [];
  const exp = c.expected ?? {};
  if (exp.mode && exp.mode !== mode) fails.push(`mode=${mode} expected ${exp.mode}`);
  for (const term of exp.mentions ?? []) {
    const hits = variants.filter((v) => v.text.toLowerCase().includes(term.toLowerCase())).length;
    if (hits < 2) fails.push(`"${term}" in <2 variants (${hits})`);
  }
  if (exp.language) {
    const mismatched = variants.filter((v) => detectLanguage(v.text) !== exp.language).length;
    if (mismatched > 0) fails.push(`${mismatched} variant(s) wrong language`);
  }
  for (const claim of exp.forbiddenClaims ?? []) {
    if (variants.some((v) => v.text.toLowerCase().includes(claim.toLowerCase()))) {
      fails.push(`forbidden claim: "${claim}"`);
    }
  }
  return fails;
}

async function runCase(c: EvalCase): Promise<{ pass: boolean; detail: string; model: string }> {
  const built = buildTaskPrompt({
    draft: c.draft,
    tone: c.tone,
    brief: c.brief,
    isWrite: c.isWrite,
  });
  try {
    const variants = await generateVariants({
      key,
      model: MODEL,
      systemInstruction: built.systemInstruction,
      userPrompt: built.userPrompt,
    });
    const quality = checkVariants(variants, { draft: c.draft, brief: c.brief, mode: built.mode as "expand" | "polish", skipAnchor: c.expected?.skipAnchor });
    const caseFails = caseChecks(c, variants, built.mode);
    const fails = [...quality.failures, ...caseFails];
    return {
      pass: fails.length === 0,
      detail: fails.length ? fails.join('; ') : 'ok',
      model: MODEL,
    };
  } catch (err) {
    if (err instanceof GeminiError && err.code === 'RATE_LIMIT') {
      await sleep((err.retryAfterMs ?? 10_000) + 1000);
      try {
        const variants = await generateVariants({
          key,
          model: MODEL,
          systemInstruction: built.systemInstruction,
          userPrompt: built.userPrompt,
        });
        const quality = checkVariants(variants, { draft: c.draft, brief: c.brief, mode: built.mode as "expand" | "polish", skipAnchor: c.expected?.skipAnchor });
        const caseFails = caseChecks(c, variants, built.mode);
        const fails = [...quality.failures, ...caseFails];
        return { pass: fails.length === 0, detail: fails.join('; ') || 'ok (after rate-limit retry)', model: MODEL };
      } catch (err2) {
        return { pass: false, detail: `retry failed: ${(err2 as Error).message}`, model: MODEL };
      }
    }
    return { pass: false, detail: (err as Error).message, model: MODEL };
  }
}

console.log(`Running ${cases.length} eval cases on ${MODEL} (key from key.txt, dev only)`);
console.log(`${cases.length} base requests + up to 1 rate-limit retry each; ~${cases.length * 2} max calls.\n`);

let passed = 0;
const rows: string[] = [];
for (const c of cases) {
  const r = await runCase(c);
  if (r.pass) passed++;
  rows.push(
    `${r.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(22)} ${r.model.padEnd(22)} ${r.detail}`,
  );
  console.log(rows[rows.length - 1]);
  await sleep(DELAY_MS);
}

console.log(`\n${passed}/${cases.length} passed (${Math.round((passed / cases.length) * 100)}%)`);
