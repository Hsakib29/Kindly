// First-run wizard (P7.7): API key → style → live demo → done.

import { PRODUCT_NAME, TAGLINE } from '../shared/brand';
import { setKey, setSettings, getSettings } from '../shared/storage';
import { TONE_IDS, type ExtensionResponse, type ToneId } from '../shared/messages';
import { sendRequest } from '../shared/client';
import { resolveTheme } from '../shared/theme';
import { patternBackgroundImage, PATTERN_BACKGROUND_SIZE } from '../shared/pattern';

void getSettings().then((st) => {
  const mode = resolveTheme(st.theme ?? 'auto');
  document.documentElement.dataset.theme = mode;
  document.body.style.backgroundImage = patternBackgroundImage(mode, 12);
  document.body.style.backgroundSize = PATTERN_BACKGROUND_SIZE;
  document.body.style.backgroundRepeat = 'repeat';
});
document.getElementById('app-title')!.textContent = PRODUCT_NAME;
document.getElementById('tagline')!.textContent = TAGLINE;

const steps = [1, 2, 3].map(
  (n) => document.querySelector(`.step-dot[data-step="${n}"]`) as HTMLElement,
);
function showStep(n: number) {
  for (const s of [1, 2, 3]) {
    document.getElementById(`step-${s}`)!.classList.toggle('hidden', s !== n);
    steps[s - 1].classList.toggle('on', s <= n);
  }
}

// ---- Step 1: key ----
const keyInput = document.getElementById('api-key') as HTMLInputElement;
const keyStatus = document.getElementById('key-status') as HTMLElement;
const verifyBtn = document.getElementById('verify') as HTMLButtonElement;

verifyBtn.addEventListener('click', async () => {
  const key = keyInput.value.trim();
  if (!key) {
    keyStatus.textContent = 'Paste your API key first.';
    keyStatus.className = 'status err';
    return;
  }
  verifyBtn.disabled = true;
  keyStatus.textContent = 'Checking…';
  keyStatus.className = 'status';
  const res = (await sendRequest<ExtensionResponse>({
    type: 'VERIFY_KEY',
    key,
  })) as Extract<ExtensionResponse, { type: 'VERIFY_KEY_RESULT' }> | Extract<ExtensionResponse, { type: 'ERROR' }>;
  verifyBtn.disabled = false;
  if (res.type === 'VERIFY_KEY_RESULT' && res.ok) {
    await setKey(key);
    keyStatus.textContent = 'Key verified.';
    keyStatus.className = 'status ok';
    setTimeout(() => showStep(2), 500);
  } else if (res.type === 'ERROR') {
    keyStatus.textContent = res.error.message;
    keyStatus.className = 'status err';
  } else {
    keyStatus.textContent = 'Verification failed.';
    keyStatus.className = 'status err';
  }
});

// ---- Step 2: style ----
const tonePick = document.getElementById('tone-pick') as HTMLElement;
let chosenTone: ToneId = 'professional';
const TONE_LABELS: Record<ToneId, string> = {
  professional: 'Professional',
  warm: 'Warm',
  short: 'Short',
  direct: 'Direct',
  empathetic: 'Empathetic',
  friendly: 'Friendly',
  grammar: 'Grammar only',
};
for (const t of TONE_IDS) {
  const label = document.createElement('label');
  label.innerHTML = `<input type="radio" name="tone" value="${t}" ${t === chosenTone ? 'checked' : ''}/> ${TONE_LABELS[t]}`;
  label.querySelector('input')!.addEventListener('change', () => {
    chosenTone = t as ToneId;
  });
  tonePick.appendChild(label);
}

document.getElementById('style-next')!.addEventListener('click', async () => {
  const bv = {
    companyName: (document.getElementById('bv-company') as HTMLInputElement).value.trim() || undefined,
    greeting: (document.getElementById('bv-greeting') as HTMLInputElement).value.trim() || undefined,
    closing: (document.getElementById('bv-closing') as HTMLInputElement).value.trim() || undefined,
  };
  const settings = await getSettings();
  await setSettings({ brandVoice: { ...settings.brandVoice, ...bv } });
  // Tone is per-rewrite in the panel; the demo already used the pick.
  showStep(3);
});

// ---- Step 3: demo ----
const demoText = document.getElementById('demo-text') as HTMLTextAreaElement;
const demoOut = document.getElementById('demo-out') as HTMLElement;
const demoStatus = document.getElementById('demo-status') as HTMLElement;
const demoGo = document.getElementById('demo-go') as HTMLButtonElement;

demoGo.addEventListener('click', async () => {
  const text = demoText.value.trim();
  if (!text) return;
  demoGo.disabled = true;
  demoOut.innerHTML = '';
  demoStatus.textContent = 'Rewriting…';
  demoStatus.className = 'status';
  const res = (await sendRequest<ExtensionResponse>({
    type: 'REWRITE',
    requestId: crypto.randomUUID(),
    text,
    tone: chosenTone,
  })) as Extract<ExtensionResponse, { type: 'REWRITE_RESULT' }> | Extract<ExtensionResponse, { type: 'ERROR' }>;
  demoGo.disabled = false;
  if (res.type === 'REWRITE_RESULT' && res.variants) {
    demoStatus.textContent = '';
    for (const v of res.variants) {
      const card = document.createElement('div');
      card.className = 'variant';
      card.innerHTML = `<div class="vlabel"></div><div></div>`;
      (card.querySelector('.vlabel') as HTMLElement).textContent = v.label;
      (card.querySelector('div + div') as HTMLElement).textContent = v.text;
      demoOut.appendChild(card);
    }
  } else if (res.type === 'ERROR') {
    demoStatus.textContent = res.error.message;
    demoStatus.className = 'status err';
  } else {
    demoStatus.textContent = 'Rewrite failed.';
    demoStatus.className = 'status err';
  }
});

// ---- Finish ----
document.getElementById('finish')!.addEventListener('click', async () => {
  await chrome.storage.local.set({ onboarded: true });
  document.getElementById('finish-tip')!.classList.remove('hidden');
  (document.getElementById('finish') as HTMLButtonElement).disabled = true;
});
