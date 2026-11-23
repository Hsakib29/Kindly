# Site Test Matrix (P4.3)

Insertion results per site. Fill in Pass/Fail + notes after testing
"Use" on each. Update after every fix in P4.4.

| Site | Field type | Method that worked | Result | Notes |
| ---- | ---------- | ------------------ | ------ | ----- |
| Gmail compose | contenteditable | execCommand | Pass | Message Body div; panel + insert verified |
| ChatGPT composer | contenteditable (ProseMirror) | execCommand | Pass | "Ask ChatGPT" box |
| Outlook web | contenteditable | | | |
| Zendesk | | | | |
| Intercom | | | | |
| Freshdesk | | | | |
| WhatsApp Web | contenteditable | | | |
| Messenger | contenteditable | | | |
| LinkedIn | | | | |
| Slack | contenteditable (Quill) | | | |
| Plain textarea (e.g. GitHub comment) | textarea | | | |

Method names reported in the page console as `[Kindly] insert succeeded via <method>`:
`native-setter`, `execCommand`, `range-insert`, `synthetic-paste`.

Clipboard fallback shows: "Could not insert on this site — text copied. Press Ctrl+V to paste."
