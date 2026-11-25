# Chrome Web Store — Listing Draft

## Name
Kindly

## Short description (max 132 chars)
AI replies that sound right, in your text boxes — powered by Gemini.

## Category
Productivity

## Detailed description

Kindly adds a quiet AI assistant to text fields across the web — Gmail,
ChatGPT, support desks, forums, docs, in many everyday apps and websites,
including Gmail and ChatGPT.

**Rewrite** — select text (or just pause typing), pick a tone, and get
three ready-to-send variants: short, balanced, and detailed. Every
variant responds to the conversation around it — names, questions, and
tone — using page context you control.

**Write** — describe what you need in plain words and get polished
drafts for emails, replies, and messages. Attach approved saved replies
for wording that must stay exact.

**Built for real work:**
- Tones: professional, warm, short, direct, empathetic, friendly, plus
  your own custom presets and brand voice (greeting, closing, words to
  use/avoid).
- Page context: understands who you're replying to and what was said —
  you can preview exactly what it reads, and turn it off per site.
- Never-run list: banking, health, and any site you choose are never
  read or touched.
- Your own Gemini API key — free tier works. Optionally encrypted with
  a passphrase.
- Keyboard-first: Alt+R opens, Ctrl+Enter applies, Esc closes.

**Privacy-first:** no account, no server, no analytics. Text goes only
from your browser to Google's Gemini API when you ask for a rewrite.
Everything else stays on your device.

## Permission justifications (for review)

- **storage** — saves your API key (optionally encrypted), tones,
  settings, per-site toggles, and usage counts locally.
- **Host permission `generativelanguage.googleapis.com`** — the only
  network call the extension makes: Gemini API requests when you
  invoke rewrite/write.
- **Content scripts on all URLs** — required to detect editable text
  fields and show the floating icon. The extension is fully lazy: no UI,
  listeners, timers or messages exist until you interact with a text
  field; page text is read only when you request a rewrite/write, and
  hidden/never-run sites are hard-blocked.
- **No `activeTab`, no `tabs`, no `webRequest`, no remote code.**

## Single purpose statement
"Rewrite and draft text in web text fields using the user's own Gemini
API key."

## Graphics needed
- 128×128 icon (have: `public/icons/icon-128.png`)
- 440×280 small promo tile, 920×680 large promo tile, 1400×560 marquee
- 5–6 screenshots: panel on Gmail reply, Write tab, tone chips,
  options page, popup
