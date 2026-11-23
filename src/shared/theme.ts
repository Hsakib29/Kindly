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
