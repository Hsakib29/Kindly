import { PRODUCT_NAME, TAGLINE } from '../shared/brand';
import { sendRequest } from '../shared/client';
import { clearKey, getKey, getSettings, setKey } from '../shared/storage';
import type { ExtensionResponse } from '../shared/messages';

type VerifyResult = Extract<ExtensionResponse, { type: 'VERIFY_KEY_RESULT' }>;

const title = document.getElementById('app-title');
if (title) title.textContent = PRODUCT_NAME;
document.title = `${PRODUCT_NAME} Options`;
const tagline = document.getElementById('tagline');
if (tagline) tagline.textContent = TAGLINE;

const buttons = document.querySelectorAll<HTMLButtonElement>('nav button');
const sections = document.querySelectorAll<HTMLElement>('main section, body > section');

for (const button of buttons) {
  button.addEventListener('click', () => {
    const target = button.dataset.section;
    for (const b of buttons) {
      b.setAttribute('aria-current', String(b === button));
    }
    for (const section of sections) {
      section.hidden = section.id !== target;
    }
  });
}

// ---------- API key section (P1.4) ----------

const keyInput = document.getElementById('api-key-input') as HTMLInputElement;
const toggleKey = document.getElementById('toggle-key') as HTMLButtonElement;
const verifyKey = document.getElementById('verify-key') as HTMLButtonElement;
const clearKeyButton = document.getElementById('clear-key') as HTMLButtonElement;
const keyStatus = document.getElementById('key-status') as HTMLParagraphElement;

function setStatus(message: string, kind?: 'ok' | 'err') {
  keyStatus.textContent = message;
  keyStatus.className = `status${kind ? ` ${kind}` : ''}`;
}

toggleKey.addEventListener('click', () => {
  const show = keyInput.type === 'password';
  keyInput.type = show ? 'text' : 'password';
  toggleKey.textContent = show ? 'Hide' : 'Show';
});

async function initKeyField() {
  const saved = await getKey();
  if (saved) {
    keyInput.placeholder = `Saved key: ${saved.slice(0, 6)}…${saved.slice(-4)}`;
    setStatus('A key is saved. Paste a new one to replace it.', 'ok');
  }
}

verifyKey.addEventListener('click', async () => {
  const key = keyInput.value.trim();
  if (!key) {
    setStatus('Paste an API key first.', 'err');
    return;
  }
  verifyKey.disabled = true;
  setStatus('Verifying…');
  try {
    const res = await sendRequest<VerifyResult>({ type: 'VERIFY_KEY', key });
    if (res.type === 'VERIFY_KEY_RESULT' && res.ok) {
      await setKey(key);
      keyInput.value = '';
      setStatus(`Key works — ${res.modelCount ?? '?'} models available.`, 'ok');
      initKeyField();
    } else if (res.type === 'VERIFY_KEY_RESULT') {
      setStatus(res.error?.message ?? 'Key verification failed.', 'err');
    } else {
      setStatus('Unexpected response from service worker.', 'err');
    }
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), 'err');
  } finally {
    verifyKey.disabled = false;
  }
});

clearKeyButton.addEventListener('click', async () => {
  await clearKey();
  keyInput.value = '';
  setStatus('Saved key cleared.', 'ok');
  initKeyField();
});

void initKeyField();

// ---------- Models section (P5.4) ----------

const routerSelect = document.getElementById('router-preference') as HTMLSelectElement;
const routerStatus = document.getElementById('router-status') as HTMLParagraphElement;

async function initRouter() {
  const settings = await getSettings();
  routerSelect.value = settings.routerPreference;
}

routerSelect.addEventListener('change', async () => {
  const res = await sendRequest<ExtensionResponse>({
    type: 'SET_SETTINGS',
    patch: { routerPreference: routerSelect.value as 'auto' | 'speed' | 'quality' },
  });
  if (res.type === 'SETTINGS') {
    routerStatus.textContent = 'Saved.';
    routerStatus.className = 'status ok';
  }
});

void initRouter();
