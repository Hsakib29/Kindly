// Gate 1 test: verify key.txt and produce 3 rewrite variants.
// Usage: node scripts/test-rewrite.mjs ["optional sample text"]
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const key = readFileSync(resolve(root, 'key.txt'), 'utf8').trim();
if (!key) {
  console.error('key.txt is empty — add your Gemini API key first.');
  process.exit(1);
}

const sample =
  process.argv[2] ??
  'Hi, just checking in on my order #4521. It was supposed to arrive last Tuesday but I still have not received a tracking update. Can someone please let me know what is going on? Thanks, Maria';

const system = `You are Kindly, an assistant that rewrites messages so they sound natural and appropriate.
Keep every fact, name, number, date, amount, and link exactly as written. Never invent details or promises.
Keep the same language as the original. Output only the requested JSON.`;

const user = `Rewrite the message below in a warm, friendly tone like a helpful human colleague.
Produce exactly 3 distinct variants.

Message to rewrite:
"""
${sample}
"""`;

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(key)}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'OBJECT',
          properties: {
            variants: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { label: { type: 'STRING' }, text: { type: 'STRING' } },
                required: ['label', 'text'],
              },
            },
          },
          required: ['variants'],
        },
      },
    }),
  },
);

const data = await res.json();
if (!res.ok) {
  console.error(`HTTP ${res.status}:`, JSON.stringify(data.error ?? data, null, 2));
  process.exit(1);
}

const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
console.log('Raw output:\n' + raw + '\n');
try {
  const parsed = JSON.parse(raw);
  const variants = parsed.variants ?? parsed;
  for (const [i, v] of (Array.isArray(variants) ? variants : []).entries()) {
    console.log(`--- Variant ${i + 1} (${v.label ?? 'unlabeled'}) ---`);
    console.log(v.text);
  }
} catch {
  console.error('Output was not valid JSON.');
  process.exit(1);
}
