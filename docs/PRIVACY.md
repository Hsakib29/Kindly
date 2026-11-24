# Privacy Policy — Kindly

_Last updated: 2026-11-23_

Kindly is a browser extension that helps you rewrite and draft text in
webpage text fields using Google's Gemini API.

## What we collect

**Nothing leaves your browser except the text you ask us to process.**

- When you click Generate/Write, the extension sends the following to
  Google's Gemini API (`generativelanguage.googleapis.com`): the text
  you asked to rewrite or the prompt you wrote, your selected tone and
  options, and — only when you have page context enabled — text
  extracted from the current page to give the model context.
- Your **Gemini API key** is stored locally in `chrome.storage` on your
  device. It is sent only to Google's API. You may optionally encrypt it
  with a passphrase (Options → API key). We never see it.
- All other settings (tones, brand voice, saved replies, per-site
  toggles, theme, usage counts) are stored locally in
  `chrome.storage.local`. Nothing is transmitted to us — there is no
  Kindly server.

## What we do NOT do

- We do not collect analytics, telemetry, or usage data.
- We do not sell or share data with anyone.
- We do not read pages in the background. The extension creates no UI,
  installs no listeners and sends no messages on page load; it activates
  only after you interact with a supported text field, and page text is
  extracted only when you invoke a rewrite/write. Sites on your
  hidden-sites or never-run lists are hard-blocked: no icon, no context
  reads, and generation requests from those sites are refused.
- We do not inject ads or track you.
- Sensitive data in page context (emails, phone numbers, card-like
  numbers, tokens, credentials in key=value patterns, etc.) is
  automatically redacted before anything is sent to Gemini.

## Third parties

Text you submit is processed by **Google Gemini** under Google's API
terms and privacy policy
(https://ai.google.dev/gemini-api/terms and
https://policies.google.com/privacy). Please do not submit sensitive
personal data you are not permitted to share with an API provider.

## Data retention

We store nothing on our side. Google retains API data according to its
own policies. Uninstalling the extension removes all local settings.

## Contact

[YOUR EMAIL / CONTACT]
