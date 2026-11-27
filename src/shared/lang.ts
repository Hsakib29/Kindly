// Coarse language detection from unicode ranges (no dependencies).
// Shared by the content script (brief building) and service worker
// (quality checks).

export function detectLanguage(text: string): 'en' | 'ja' | 'bn' | 'other' {
  if (!text) return 'en';
  let ja = 0;
  let bn = 0;
  let ko = 0;
  let letters = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x3040 && c <= 0x30ff)
      ja++; // hiragana + katakana
    else if (c >= 0x4e00 && c <= 0x9fff)
      ja++; // CJK ideographs ~ ja/zh bucket
    else if (c >= 0x0980 && c <= 0x09ff) bn++;
    else if (c >= 0xac00 && c <= 0xd7af) ko++;
    else if (/[a-zA-Z]/.test(ch)) letters++;
  }
  const total = ja + bn + ko + letters;
  if (total === 0) return 'en';
  if (bn / total > 0.3) return 'bn';
  if (ja / total > 0.3) return 'ja';
  if (ko / total > 0.3) return 'other';
  return 'en';
}
