// WCAG contrast audit for the theme tokens (npm run contrast).
// Bundles a tiny runner that imports THEME_TOKENS, computes ratios for
// every text/control pair, prints a table, exits 1 on any failure.

import { build } from 'esbuild';

await build({
  entryPoints: ['tests/contrast/run.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: 'tests/contrast/.build/run.mjs',
  logLevel: 'warning',
});
await import('../tests/contrast/.build/run.mjs');
