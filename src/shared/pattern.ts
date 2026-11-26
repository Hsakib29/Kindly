// Botanical background pattern for the Rhododendron theme.
// Drawn from original shapes only (blossoms, leaves, stems, a butterfly).
// Deterministic: the same inputs always produce the same SVG.

export type PatternPalette = 'light' | 'dark';

export const PATTERN_SEED = 7;
export const PATTERN_TILE_SIZE = 320;
export const PATTERN_STRENGTH_MAX = 30;

// Pattern colors per palette: [blossom, leaf and stem, bud and accent]
const PATTERN_COLORS: Record<PatternPalette, [string, string, string]> = {
  light: ['#4F72C4', '#8E9C92', '#A9B4DF'],
  dark: ['#9DB8F0', '#6F8A7E', '#5B6FA6'],
};

/** Seeded random number generator (mulberry32). Same seed gives the same sequence. */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clamp strength to 0..30 and turn it into an opacity between 0 and 1. */
export function strengthToOpacity(strength: number): number {
  const clamped = Math.min(PATTERN_STRENGTH_MAX, Math.max(0, Math.round(strength)));
  return clamped / 100;
}

/** Build the 320 x 320 tile as an SVG string. */
export function tileSVG(palette: PatternPalette, strength: number, seed: number = PATTERN_SEED): string {
  const [c1, c2, c3] = PATTERN_COLORS[palette];
  const op = strengthToOpacity(strength).toFixed(2);
  const r = rng(seed);
  const R = (a: number, b: number) => a + (b - a) * r();
  let out = '';

  // Stems with leaves
  const stems = 3 + Math.floor(r() * 2);
  for (let s = 0; s < stems; s++) {
    const x0 = R(-10, 330), y0 = R(-10, 330);
    const x1 = x0 + R(-140, 140), y1 = y0 + R(-140, 140);
    const cx = (x0 + x1) / 2 + R(-60, 60), cy = (y0 + y1) / 2 + R(-60, 60);
    out += `<path d="M${x0.toFixed(0)} ${y0.toFixed(0)} Q${cx.toFixed(0)} ${cy.toFixed(0)} ${x1.toFixed(0)} ${y1.toFixed(0)}" stroke="${c2}" stroke-width="${R(0.9, 1.6).toFixed(2)}" fill="none" opacity="0.8"/>`;
    const n = 4 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const t = R(0.1, 0.95);
      const px = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
      const py = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1;
      const ang = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI + (r() < 0.5 ? -1 : 1) * R(25, 70);
      const rx = R(8, 17), ry = rx * R(0.35, 0.5);
      out += `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${c2}" opacity="${R(0.55, 0.95).toFixed(2)}" transform="rotate(${ang.toFixed(0)} ${px.toFixed(1)} ${py.toFixed(1)})"/>`;
    }
  }

  // Blossoms (five petals and a center)
  const blooms = 4 + Math.floor(r() * 3);
  for (let b = 0; b < blooms; b++) {
    const x = R(0, 320), y = R(0, 320), rad = R(7, 14), rot = R(0, 72);
    const fill = r() < 0.6 ? c1 : c3;
    for (let i = 0; i < 5; i++) {
      const a = ((i * 72 + rot - 90) * Math.PI) / 180;
      out += `<circle cx="${(x + Math.cos(a) * rad * 0.9).toFixed(1)}" cy="${(y + Math.sin(a) * rad * 0.9).toFixed(1)}" r="${(rad * 0.6).toFixed(1)}" fill="${fill}" opacity="${R(0.7, 1).toFixed(2)}"/>`;
    }
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(rad * 0.22).toFixed(1)}" fill="${c3}"/>`;
  }

  // Buds
  for (let u = 0; u < 4; u++) {
    out += `<circle cx="${R(0, 320).toFixed(1)}" cy="${R(0, 320).toFixed(1)}" r="${R(2.5, 4.5).toFixed(1)}" fill="${c3}" opacity="0.8"/>`;
  }

  // One small butterfly
  const bx = R(30, 290), by = R(30, 290), br = R(-30, 30);
  out += `<g transform="translate(${bx.toFixed(0)} ${by.toFixed(0)}) rotate(${br.toFixed(0)})" fill="${c3}"><ellipse cx="-5" cy="-3" rx="6" ry="4" opacity="0.8"/><ellipse cx="5" cy="-3" rx="6" ry="4" opacity="0.8"/><ellipse cx="-4" cy="3" rx="4" ry="3" opacity="0.6"/><ellipse cx="4" cy="3" rx="4" ry="3" opacity="0.6"/></g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PATTERN_TILE_SIZE}" height="${PATTERN_TILE_SIZE}" viewBox="0 0 ${PATTERN_TILE_SIZE} ${PATTERN_TILE_SIZE}"><g opacity="${op}">${out}</g></svg>`;
}

/**
 * CSS value for background-image, e.g. url("data:image/svg+xml,...").
 * Returns 'none' when strength is 0, so no pattern is drawn.
 */
export function patternBackgroundImage(palette: PatternPalette, strength: number): string {
  if (strengthToOpacity(strength) === 0) return 'none';
  return `url("data:image/svg+xml,${encodeURIComponent(tileSVG(palette, strength))}")`;
}

/** Pattern settings to apply to a surface. Use the background-size value too. */
export const PATTERN_BACKGROUND_SIZE = `${PATTERN_TILE_SIZE}px ${PATTERN_TILE_SIZE}px`;
