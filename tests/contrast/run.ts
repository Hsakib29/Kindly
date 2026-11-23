// Contrast audit runner — imported by scripts/contrast.mjs after bundling.

import { THEME_TOKENS, type ThemeMode } from '../../src/shared/theme';

function lum(hex: string): number {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a: string, b: string): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

interface Check {
  name: string;
  fg: keyof (typeof THEME_TOKENS)['light'];
  bg: keyof (typeof THEME_TOKENS)['light'];
  min: number;
}

const CHECKS: Check[] = [
  { name: 'text on surface', fg: 'text', bg: 'surface', min: 4.5 },
  { name: 'text on background', fg: 'text', bg: 'bg', min: 4.5 },
  { name: 'text-secondary on surface', fg: 'textSecondary', bg: 'surface', min: 4.5 },
  { name: 'text-secondary on background', fg: 'textSecondary', bg: 'bg', min: 4.5 },
  { name: 'placeholder on surface', fg: 'placeholder', bg: 'surface', min: 4.5 },
  { name: 'text-disabled on surface', fg: 'textDisabled', bg: 'surface', min: 3 },
  { name: 'text-on-accent on accent', fg: 'textOnAccent', bg: 'accent', min: 4.5 },
  { name: 'accent text on surface', fg: 'accent', bg: 'surface', min: 4.5 },
  { name: 'accentText on background', fg: 'accentText', bg: 'bg', min: 4.5 },
  { name: 'control-border on surface', fg: 'controlBorder', bg: 'surface', min: 3 },
  { name: 'divider on surface', fg: 'divider', bg: 'surface', min: 1.5 },
  { name: 'danger on surface', fg: 'danger', bg: 'surface', min: 4.5 },
  { name: 'danger on dangerBg', fg: 'danger', bg: 'dangerBg', min: 4.5 },
  { name: 'success on surface', fg: 'success', bg: 'surface', min: 4.5 },
  { name: 'warning on surface', fg: 'warning', bg: 'surface', min: 4.5 },
  { name: 'skeleton-base on surface', fg: 'skeletonBase', bg: 'surface', min: 1.1 },
];

let failed = 0;
for (const mode of ['light', 'dark'] as ThemeMode[]) {
  const t = THEME_TOKENS[mode];
  console.log(`\n=== ${mode.toUpperCase()} ===`);
  console.log('pair'.padEnd(34) + 'ratio'.padStart(8) + '  min  result');
  for (const c of CHECKS) {
    const r = ratio(t[c.fg], t[c.bg]);
    const pass = r >= c.min;
    if (!pass) failed++;
    console.log(
      `${c.name.padEnd(34)}${r.toFixed(2).padStart(8)}  ${c.min}   ${pass ? 'PASS' : 'FAIL'}`,
    );
  }
}

console.log(failed === 0 ? '\nAll contrast checks pass.' : `\n${failed} check(s) FAILED.`);
process.exit(failed ? 1 : 0);
