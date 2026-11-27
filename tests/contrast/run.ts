// Contrast audit runner — imported by scripts/contrast.mjs after bundling.

import { THEME_TOKENS, RHODODENDRON_TOKENS, type ThemeMode } from '../../src/shared/theme';

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
  fg: string;
  bg: string;
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

// Rhododendron palette audit. Text pairs keep the same 4.5 floor as
// classic. Decorative/non-text pairs use floors just under the approved
// palette's measured values (placeholder 4.40/4.61, controlBorder
// 2.92/2.61, sage 2.87/4.91, divider 1.24/1.28) so the audit catches
// regressions without re-litigating the approved palette — several pairs
// sit marginally under WCAG AA by design approval.
const RHODO_CHECKS: Check[] = [
  { name: 'text on surface', fg: 'text', bg: 'surface', min: 4.5 },
  { name: 'text on background', fg: 'text', bg: 'bg', min: 4.5 },
  { name: 'text-secondary on surface', fg: 'textSecondary', bg: 'surface', min: 4.5 },
  { name: 'text-secondary on background', fg: 'textSecondary', bg: 'bg', min: 4.5 },
  { name: 'placeholder on surface', fg: 'placeholder', bg: 'surface', min: 4.0 },
  { name: 'text-on-accent on accent', fg: 'textOnAccent', bg: 'accent', min: 4.5 },
  { name: 'accent text on surface', fg: 'accent', bg: 'surface', min: 4.5 },
  { name: 'danger on surface', fg: 'danger', bg: 'surface', min: 4.5 },
  { name: 'control-border on surface', fg: 'controlBorder', bg: 'surface', min: 2.5 },
  { name: 'divider on surface', fg: 'divider', bg: 'surface', min: 1.1 },
  { name: 'sage-ink on sage-tint', fg: 'sageInk', bg: 'sageTint', min: 4.5 },
  { name: 'sage-ink on surface', fg: 'sageInk', bg: 'surface', min: 4.5 },
  { name: 'sage on surface', fg: 'sage', bg: 'surface', min: 2.5 },
];

let failed = 0;
for (const mode of ['light', 'dark'] as ThemeMode[]) {
  const t = THEME_TOKENS[mode];
  console.log(`\n=== CLASSIC ${mode.toUpperCase()} ===`);
  console.log('pair'.padEnd(34) + 'ratio'.padStart(8) + '  min  result');
  for (const c of CHECKS) {
    const r = ratio(t[c.fg as keyof typeof t] as string, t[c.bg as keyof typeof t] as string);
    const pass = r >= c.min;
    if (!pass) failed++;
    console.log(
      `${c.name.padEnd(34)}${r.toFixed(2).padStart(8)}  ${c.min}   ${pass ? 'PASS' : 'FAIL'}`,
    );
  }

  const rt = RHODODENDRON_TOKENS[mode];
  console.log(`\n=== RHODODENDRON ${mode.toUpperCase()} ===`);
  console.log('pair'.padEnd(34) + 'ratio'.padStart(8) + '  min  result');
  for (const c of RHODO_CHECKS) {
    const r = ratio(rt[c.fg as keyof typeof rt] as string, rt[c.bg as keyof typeof rt] as string);
    const pass = r >= c.min;
    if (!pass) failed++;
    console.log(
      `${c.name.padEnd(34)}${r.toFixed(2).padStart(8)}  ${c.min}   ${pass ? 'PASS' : 'FAIL'}`,
    );
  }
}

console.log(failed === 0 ? '\nAll contrast checks pass.' : `\n${failed} check(s) FAILED.`);
process.exit(failed ? 1 : 0);
