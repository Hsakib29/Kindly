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
// Custom listbox dropdown — the native <select> popup ignores page
// colors on Windows, leaving light text on a white list in dark mode.

const dropdown = document.getElementById('router-dropdown') as HTMLElement;
const dropdownButton = dropdown.querySelector('.dropdown-button') as HTMLButtonElement;
const dropdownLabel = dropdown.querySelector('.dropdown-label') as HTMLElement;
const dropdownList = dropdown.querySelector('.dropdown-list') as HTMLUListElement;
const routerStatus = document.getElementById('router-status') as HTMLParagraphElement;

const LABELS: Record<string, string> = {
  auto: 'Auto (recommended)',
  speed: 'Prefer speed',
  quality: 'Prefer quality',
};

let open = false;
let activeIndex = -1;

function options(): HTMLElement[] {
  return Array.from(dropdownList.querySelectorAll<HTMLElement>('[role="option"]'));
}

function setOpen(next: boolean) {
  open = next;
  dropdownList.hidden = !open;
  dropdownButton.setAttribute('aria-expanded', String(open));
  if (open) {
    const selected = options().findIndex((o) => o.getAttribute('aria-selected') === 'true');
    activeIndex = selected >= 0 ? selected : 0;
    highlight(activeIndex);
  }
}

function highlight(index: number) {
  const opts = options();
  activeIndex = (index + opts.length) % opts.length;
  opts.forEach((o, i) => o.classList.toggle('active', i === activeIndex));
}

function select(index: number) {
  const opt = options()[index];
  if (!opt) return;
  for (const o of options()) {
    o.setAttribute('aria-selected', String(o === opt));
  }
  dropdownLabel.textContent = opt.querySelector('.opt')?.textContent ?? opt.textContent ?? '';
  setOpen(false);
  void savePreference(opt.dataset.value ?? 'auto');
}

async function savePreference(value: string) {
  const res = await sendRequest<ExtensionResponse>({
    type: 'SET_SETTINGS',
    patch: { routerPreference: value as 'auto' | 'speed' | 'quality' },
  });
  if (res.type === 'SETTINGS') {
    routerStatus.textContent = 'Saved.';
    routerStatus.className = 'status ok';
  }
}

dropdownButton.addEventListener('click', () => setOpen(!open));

dropdownList.addEventListener('click', (e) => {
  const opt = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
  if (opt) select(options().indexOf(opt));
});

dropdownButton.addEventListener('keydown', (e) => {
  if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    setOpen(true);
    return;
  }
  if (!open) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlight(activeIndex + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlight(activeIndex - 1);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    select(activeIndex);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    setOpen(false);
  } else if (e.key.length === 1) {
    // Type-ahead: jump to the first option starting with the typed letter.
    const letter = e.key.toLowerCase();
    const idx = options().findIndex((o) =>
      (o.textContent ?? '').trim().toLowerCase().startsWith(letter),
    );
    if (idx >= 0) highlight(idx);
  }
});

document.addEventListener('click', (e) => {
  if (open && !dropdown.contains(e.target as Node)) setOpen(false);
});

async function initRouter() {
  const settings = await getSettings();
  const value = settings.routerPreference;
  for (const o of options()) {
    o.setAttribute('aria-selected', String(o.dataset.value === value));
  }
  dropdownLabel.textContent = LABELS[value] ?? LABELS.auto;
}

void initRouter();

// ---------- Developer section (debug logging) ----------

const debugCheckbox = document.getElementById('debug-logging') as HTMLInputElement;

async function initDebug() {
  const settings = await getSettings();
  debugCheckbox.checked = settings.debug;
}

debugCheckbox.addEventListener('change', async () => {
  const res = await sendRequest<ExtensionResponse>({
    type: 'SET_SETTINGS',
    patch: { debug: debugCheckbox.checked },
  });
  if (res.type === 'SETTINGS') {
    debugCheckbox.checked = res.settings.debug;
  }
});

void initDebug();
