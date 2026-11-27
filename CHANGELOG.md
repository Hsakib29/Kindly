# Changelog

All notable changes to Kindly are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.2] - Unreleased

### Changed

- Reply panel: botanical pattern now spans the full tab content area on both
  Rewrite and Write tabs, with solid header, tabs, footer bars, and cards.
- Reply panel: empty context chip row is hidden; Rewrite/Write tabs span full
  width; Generate is emphasized as the primary CTA until variants exist;
  variant cards update `aria-pressed` on selection; Write-tab `<option>`
  elements get explicit surface/text colors for Windows dark mode.
- Toolbar popup: usage and Settings moved to a footer below the site card;
  hostname shown muted under the site toggle; decorative pattern band
  enlarged with a sage-tint base.
- Options page: sidebar emojis replaced with monochrome SVG icons; Page
  context and Privacy policy are separate nav targets; botanical pattern
  paints the full `<main>` background while content keeps a readable width;
  tone/reply empty states wired; Clear key asks for confirmation; "Saved."
  statuses auto-clear after ~2.5s.
- Onboarding: brand logo header, Skip for now / Back navigation, API key
  Show/Hide toggle, aistudio.google.com link, selected tone pill highlight,
  and an Open Settings button after finishing.
- Floating icon: reduced to 24px and collision-aware — probes
  `elementsFromPoint` and shifts left past composer buttons (Send, Mic,
  model pickers) or moves outside the field when needed.
- Default pattern strength raised from 14 to 22; swatch chips use
  `accentTint` for the middle color.

## [0.1.1]

### Added

- Rhododendron color theme: approved botanical palette (light/dark tokens,
  `--sage`/`--sage-tint`/`--sage-ink` accents) across panel, popup, options,
  and welcome surfaces.
- Botanical background pattern: deterministic SVG tile with seamless
  9-offset wrap-around rendering, pattern-strength slider (0–30), and
  per-surface pattern placement (panel bodies, options `<main>`, welcome
  body, popup band).
- New SVG app icon and floating icon assets.
- UI polish across options layout, reply panel, popup, and welcome page.
- Contrast audit extended to the Rhododendron tokens; unit tests for the
  pattern generator and theme helpers.

## [0.1.0]

### Added

- Initial extension release.
- Reply panel with Rewrite and Write tabs, tone chips, custom tones, and
  variant cards.
- Gemini router with speed/quality/auto preferences and model fallback.
- Privacy masking for card numbers, emails, phones, tokens, and secrets
  before text leaves the browser.
- Optional AES-256-GCM encryption for the stored API key.
- Per-site enable toggles, page-context controls, never-run site list, and
  custom brand voice.
- Saved replies that can be attached as approved wording in Write mode.
- First-run onboarding wizard: API key → style → live demo → done.
- Toolbar popup with per-site state and daily usage count.
