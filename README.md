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
manifest.template.json   MV3 manifest source (placeholders filled per build)
scripts/sync-manifest.mjs  Generates public/manifest.json at build time
public/manifest.json     Generated manifest (copied to dist/)
options.html             Options page entry
popup.html               Toolbar popup entry
welcome.html             Welcome/setup page entry
src/background/          Service worker
src/content/             Content script (bundled as a classic script via esbuild)
src/options/             Options page logic
src/popup/               Toolbar popup logic
src/shared/              Shared types and helpers
src/welcome/             Welcome/setup page logic
tests/                   Unit, eval, and contrast test suites
docs/                    Privacy policy, site matrix, store listing
```

## Notes

- The content script is bundled separately with esbuild (`--format=iife`) because
  `content_scripts` must be classic scripts, not ES modules.
- Never commit API keys. Test keys go in a git-ignored file (e.g. `key.txt`).

## Testing and debugging

Debug logging is OFF by default. Enable it in **Options → Developer → "Log details to the console (for testing)"**.

Where the logs appear:

- **Page logs** (context extraction stats): open DevTools (`F12`) on the web page and check the **Console** tab. Filter for `[Kindly]`.
- **Service worker logs** (Gemini requests: task, model attempts, prompt, timing): go to `chrome://extensions`, find Kindly, and click the **service worker** link — that opens its DevTools console.

Each Gemini request is wrapped in a collapsed `console.groupCollapsed` — click it to expand the full prompt and response time. The API key is never logged.

Quick toggle without opening options: there is no page-console command (content scripts run in an isolated world). Use the options checkbox, or send `{type:'SET_SETTINGS', patch:{debug:true}}` via `chrome.runtime.sendMessage` from the options page console.

To strip all debug code from a build, set `STRIP_DEBUG_LOGS = true` in `src/shared/debug.ts` before building.
