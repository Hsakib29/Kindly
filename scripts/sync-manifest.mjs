// Generates public/manifest.json from manifest.template.json + brand.config.json.
// Run automatically before every build via the npm scripts.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const brand = JSON.parse(readFileSync(resolve(root, 'brand.config.json'), 'utf8'));
let manifest = readFileSync(resolve(root, 'manifest.template.json'), 'utf8');

for (const [key, value] of Object.entries(brand)) {
  manifest = manifest.replaceAll(`{{${toScreamingSnake(key)}}}`, String(value));
}

const leftover = manifest.match(/\{\{[A-Z_]+\}\}/g);
if (leftover) {
  console.error(`[kindly] unsubstituted placeholders in manifest: ${leftover.join(', ')}`);
  process.exit(1);
}

mkdirSync(resolve(root, 'public'), { recursive: true });
writeFileSync(resolve(root, 'public', 'manifest.json'), manifest);
console.log(`[kindly] manifest.json generated (name: "${brand.storeTitle}")`);

function toScreamingSnake(str) {
  return str.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
}
