// Bundles the TS eval runner with esbuild, then executes it.
// Dev only — never part of dist/.
import { build } from 'esbuild';

await build({
  entryPoints: ['tests/eval/run.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: 'tests/eval/.build/run.mjs',
  logLevel: 'warning',
});

await import('../tests/eval/.build/run.mjs');
