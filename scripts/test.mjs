// Bundles the TS unit tests with esbuild, then executes them.
import { build } from 'esbuild';

await build({
  entryPoints: ['tests/unit/run.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outfile: 'tests/unit/.build/run.mjs',
  logLevel: 'warning',
});

await import('../tests/unit/.build/run.mjs');
