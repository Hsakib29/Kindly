// Design tokens for Kindly UI (panel, popup, options, welcome).
// Two complete sets — light and dark — plus theme resolution.
// Base palette values are fixed; derived tokens are tuned only for
// contrast (verified by `npm run contrast`).

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = 'auto' | ThemeMode;

export interface ThemeTokens {
  // Base (fixed palette)
  bg: string;
  surface: string;
  text: string;
  accent: string;
  border: string;
  // Derived
  textSecondary: string;
  placeholder: string;
  textDisabled: string;
  controlBorder: string;
  accentHover: string;
  accentActive: string;
  accentTint: string;
  textOnAccent: string;
  danger: string;
  dangerBg: string;
  success: string;
  warning: string;
  skeletonBase: string;
  skeletonShimmer: string;
  focusRing: string;
  shadow: string;
  divider: string;
  /** Accent darkened/lightened for text-on-background links. */
  accentText: string;
}

export const THEME_TOKENS: Record<ThemeMode, ThemeTokens> = {
  light: {
    bg: '#F5F7FF',
    surface: '#FFFFFF',
    text: '#202B50',
    accent: '#5269D8',
    border: '#DCE3FF',
    textSecondary: '#4C5683',
    placeholder: '#5A6690',
    textDisabled: '#7C86AC',
    controlBorder: '#7F89BC',
    accentHover: '#4356C4',
    accentActive: '#384DB0',
    accentTint: '#E3E9FF',
    textOnAccent: '#FFFFFF',
    danger: '#B3261E',
    dangerBg: '#FDECEA',
    success: '#1B7A3D',
    warning: '#8A5A00',
    skeletonBase: '#E6EBF8',
    skeletonShimmer: '#F4F7FF',
    focusRing: '#5269D8',
    shadow: 'rgba(32,43,80,0.22)',
    divider: '#C6D0F2',
    accentText: '#4756C0',
  },
  dark: {
    bg: '#0D1224',
    surface: '#171F3A',
    text: '#F4F6FF',
    accent: '#AFC0FF',
    border: '#303B61',
    textSecondary: '#A9B4D8',
    placeholder: '#8B96BC',
    textDisabled: '#6B7699',
    controlBorder: '#6B78A3',
    accentHover: '#C3D0FF',
    accentActive: '#D6E0FF',
    accentTint: '#26314F',
    textOnAccent: '#0D1224',
    danger: '#FFB4AB',
    dangerBg: '#3A1E22',
    success: '#8FD6A0',
    warning: '#E8C37A',
    skeletonBase: '#232C4A',
    skeletonShimmer: '#2E3A5E',
    focusRing: '#AFC0FF',
    shadow: 'rgba(0,0,0,0.55)',
    divider: '#46538A',
    accentText: '#AFC0FF',
  },
};

/** CSS custom-property block for a theme (used inside shadow roots/pages). */
export function themeCssVars(mode: ThemeMode): string {
  const t = THEME_TOKENS[mode];
  return Object.entries(t)
    .map(([k, v]) => `--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}: ${v};`)
    .join(' ');
}

/** Resolve 'auto' against the system preference. */
export function resolveTheme(pref: ThemePreference): ThemeMode {
  if (pref !== 'auto') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Live resolver for 'auto' — returns current mode and a change callback. */
export function watchSystemTheme(cb: (mode: ThemeMode) => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const fn = () => cb(mq.matches ? 'dark' : 'light');
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}

/** Approved Rhododendron palette (docs/design reference). Full token override. */
export interface RhododendronTokens {
  bg: string;
  surface: string;
  text: string;
  accent: string;
  border: string;
  textSecondary: string;
  placeholder: string;
  controlBorder: string;
  accentTint: string;
  textOnAccent: string;
  danger: string;
  focusRing: string;
  divider: string;
  shadow: string;
  sage: string;
  sageTint: string;
  sageInk: string;
}

export const RHODODENDRON_TOKENS: Record<ThemeMode, RhododendronTokens> = {
  light: {
    bg: '#F4F5F0',
    surface: '#FFFFFF',
    text: '#26304A',
    accent: '#4F72C4',
    border: '#D5DCEB',
    textSecondary: '#566079',
    placeholder: '#6F7892',
    controlBorder: '#8C97B3',
    accentTint: '#E4EAF8',
    textOnAccent: '#FFFFFF',
    danger: '#A8382F',
    focusRing: '#4F72C4',
    divider: '#E3E7EE',
    shadow: 'rgba(38,48,74,.18)',
    sage: '#8E9C92',
    sageTint: '#E7EDE8',
    sageInk: '#46574D',
  },
  dark: {
    bg: '#111826',
    surface: '#1A2233',
    text: '#EEF1F7',
    accent: '#9DB8F0',
    border: '#2F3B56',
    textSecondary: '#A7B1C8',
    placeholder: '#7F8AA5',
    controlBorder: '#56627F',
    accentTint: '#26324D',
    textOnAccent: '#111826',
    danger: '#F2A8A0',
    focusRing: '#9DB8F0',
    divider: '#29344D',
    shadow: 'rgba(0,0,0,.5)',
    sage: '#7E9488',
    sageTint: '#1F2D29',
    sageInk: '#C5D6CC',
  },
};

/** Apply a color theme's tokens as inline CSS vars on an element (overrides stylesheet). */
export function applyColorTheme(
  el: HTMLElement,
  colorTheme: 'classic' | 'rhododendron' | undefined,
  mode: ThemeMode,
): void {
  const st = el.style;
  if (colorTheme !== 'rhododendron') {
    // Classic: clear any inline overrides so stylesheet tokens apply.
    for (const k of Object.keys(RHODODENDRON_TOKENS.light)) {
      st.removeProperty('--' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));
    }
    for (const k of ['sage', 'sage-tint', 'sage-ink']) st.removeProperty('--' + k);
    return;
  }
  const t = RHODODENDRON_TOKENS[mode];
  const set = (name: string, v: string) => st.setProperty('--' + name, v);
  set('bg', t.bg);
  set('surface', t.surface);
  set('text', t.text);
  set('accent', t.accent);
  set('border', t.border);
  set('text-secondary', t.textSecondary);
  set('placeholder', t.placeholder);
  set('control-border', t.controlBorder);
  set('accent-tint', t.accentTint);
  set('text-on-accent', t.textOnAccent);
  set('danger', t.danger);
  set('focus-ring', t.focusRing);
  set('divider', t.divider);
  set('shadow', t.shadow);
  set('sage', t.sage);
  set('sage-tint', t.sageTint);
  set('sage-ink', t.sageInk);
}

/** Three chip colors (bg, surface, accent) for the picker swatch strips. */
export function paletteChips(
  colorTheme: 'classic' | 'rhododendron' | undefined,
  mode: ThemeMode,
): [string, string, string] {
  if (colorTheme === 'rhododendron') {
    const t = RHODODENDRON_TOKENS[mode];
    return [t.bg, t.accentTint, t.accent];
  }
  const t = THEME_TOKENS[mode];
  return [t.bg, t.surface, t.accent];
}

/** Back-compat palette used by pattern surfaces. */
export interface AppPalette {
  bg: string;
  surface: string;
  accent: string;
}

export function appPalette(
  colorTheme: 'classic' | 'rhododendron' | undefined,
  mode: ThemeMode,
): AppPalette {
  const [bg, surface, accent] = paletteChips(colorTheme, mode);
  return { bg, surface, accent };
}

/** True when the botanical pattern should render on a surface. */
export function patternActive(
  colorTheme: 'classic' | 'rhododendron' | undefined,
  strength: number | undefined,
): boolean {
  return colorTheme === 'rhododendron' && (strength ?? 0) > 0;
}
