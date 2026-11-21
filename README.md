# Kindly

AI replies that sound right, in any text box. A Manifest V3 Chrome extension.

## Setup

```sh
npm install
npm run build      # one-off production build into dist/
npm run dev        # watch mode: rebuilds on save
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

## Loading the extension

1. Run `npm run build` (or `npm run dev` for watch mode).
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.
4. Reload the extension after each rebuild.

## Project structure

```
public/manifest.json   MV3 manifest (copied to dist/)
options.html           Options page entry
src/background/        Service worker
src/content/           Content script (bundled as a classic script via esbuild)
src/options/           Options page logic
src/shared/            Shared types and helpers (added in P1.1)
```

## Notes

- The content script is bundled separately with esbuild (`--format=iife`) because
  `content_scripts` must be classic scripts, not ES modules.
- Never commit API keys. Test keys go in a git-ignored file (e.g. `key.txt`).
