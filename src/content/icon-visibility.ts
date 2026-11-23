// Icon visibility thresholds — one place to tune (Q1).
//
// Show rules:
//   - Field has text: icon appears after the typing pause when the text has
//     >= minWords words OR >= minChars characters (whichever first; the char
//     rule covers languages without spaces, e.g. Japanese, Bengali).
//   - Field is empty: a quieter icon appears ONLY in large writing areas
//     (multi-line / tall fields), never in single-line inputs.
//   - When text drops below the threshold, the icon stays for
//     belowThresholdGraceMs before hiding (no flicker while deleting).

export const ICON_VISIBILITY = {
  minWords: 2,
  minChars: 6,
  /** Empty fields must be at least this tall to show the quiet icon. */
  minEmptyFieldHeightPx: 60,
  /** Grace period before hiding when text falls below the threshold. */
  belowThresholdGraceMs: 800,
} as const;
