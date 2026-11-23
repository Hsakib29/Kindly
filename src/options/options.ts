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

// ---------- Custom tones (P7.2) ----------

const toneList = document.getElementById('tone-list') as HTMLElement;
const toneName = document.getElementById('tone-name') as HTMLInputElement;
const toneInstruction = document.getElementById('tone-instruction') as HTMLInputElement;
const tonePinned = document.getElementById('tone-pinned') as HTMLInputElement;
const toneAdd = document.getElementById('tone-add') as HTMLButtonElement;
const toneStatus = document.getElementById('tone-status') as HTMLParagraphElement;

let customTones: import('../shared/messages').CustomTone[] = [];

function renderTones() {
  toneList.innerHTML = '';
  for (const t of customTones) {
    const row = document.createElement('div');
    row.className = 'tone-item';
    row.innerHTML = `<span class="name"></span><span class="instr"></span>`;
    (row.querySelector('.name') as HTMLElement).textContent = t.name + (t.pinned ? ' (pinned)' : '');
    (row.querySelector('.instr') as HTMLElement).textContent = t.instruction;
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.textContent = t.pinned ? 'Unpin' : 'Pin';
    pin.addEventListener('click', () => {
      customTones = customTones.map((x) => (x.id === t.id ? { ...x, pinned: !x.pinned } : x));
      void saveTones();
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      customTones = customTones.filter((x) => x.id !== t.id);
      void saveTones();
    });
    row.append(pin, del);
    toneList.appendChild(row);
  }
}

async function saveTones() {
  const res = await sendRequest<ExtensionResponse>({
    type: 'SET_SETTINGS',
    patch: { customTones },
  });
  if (res.type === 'SETTINGS') {
    customTones = res.settings.customTones;
    renderTones();
    toneStatus.textContent = 'Saved.';
    toneStatus.className = 'status ok';
  }
}

toneAdd.addEventListener('click', () => {
  const name = toneName.value.trim();
  const instruction = toneInstruction.value.trim();
  if (!name || !instruction) {
    toneStatus.textContent = 'Name and instruction are required.';
    toneStatus.className = 'status err';
    return;
  }
  customTones = [
    ...customTones,
    { id: crypto.randomUUID(), name, instruction, pinned: tonePinned.checked },
  ];
  toneName.value = '';
  toneInstruction.value = '';
  tonePinned.checked = false;
  void saveTones();
});

// ---------- Brand voice (P7.1) ----------

const bvCompany = document.getElementById('bv-company') as HTMLInputElement;
const bvGreeting = document.getElementById('bv-greeting') as HTMLInputElement;
const bvClosing = document.getElementById('bv-closing') as HTMLInputElement;
const bvUse = document.getElementById('bv-use') as HTMLInputElement;
const bvAvoid = document.getElementById('bv-avoid') as HTMLInputElement;
const bvStatus = document.getElementById('bv-status') as HTMLParagraphElement;

const splitCsv = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

async function saveBrandVoice() {
  const formality = (
    document.querySelector('input[name="bv-formality"]:checked') as HTMLInputElement
  )?.value as 'casual' | 'neutral' | 'formal' | '' | undefined;
  const res = await sendRequest<ExtensionResponse>({
    type: 'SET_SETTINGS',
    patch: {
      brandVoice: {
        companyName: bvCompany.value.trim() || undefined,
        greeting: bvGreeting.value.trim() || undefined,
        closing: bvClosing.value.trim() || undefined,
        wordsToUse: splitCsv(bvUse.value),
        wordsToAvoid: splitCsv(bvAvoid.value),
        formality: formality || undefined,
      },
    },
  });
  if (res.type === 'SETTINGS') {
    bvStatus.textContent = 'Saved.';
    bvStatus.className = 'status ok';
  }
}

for (const el of [bvCompany, bvGreeting, bvClosing, bvUse, bvAvoid]) {
  el.addEventListener('change', () => void saveBrandVoice());
}
for (const radio of Array.from(document.querySelectorAll('input[name="bv-formality"]'))) {
  radio.addEventListener('change', () => void saveBrandVoice());
}

async function initTonesAndVoice() {
  const settings = await getSettings();
  customTones = settings.customTones ?? [];
  renderTones();
  const bv = settings.brandVoice ?? {};
  bvCompany.value = bv.companyName ?? '';
  bvGreeting.value = bv.greeting ?? '';
  bvClosing.value = bv.closing ?? '';
  bvUse.value = (bv.wordsToUse ?? []).join(', ');
  bvAvoid.value = (bv.wordsToAvoid ?? []).join(', ');
  const f = bv.formality ?? '';
  const radio = document.querySelector(`input[name="bv-formality"][value="${f}"]`) as
    | HTMLInputElement
    | null;
  if (radio) radio.checked = true;
}

void initTonesAndVoice();

// ---------- Never-run sites (P7.3) ----------

const neverRunArea = document.getElementById('never-run') as HTMLTextAreaElement;
const sitesStatus = document.getElementById('sites-status') as HTMLParagraphElement;

async function initNeverRun() {
  const settings = await getSettings();
  // First run: seed the editable list with the defaults so the user can
  // remove entries — an explicitly emptied list then means "allow all".
  if (settings.neverRunSites.length === 0) {
    const { DEFAULT_NEVER_RUN_SITES } = await import('../shared/messages');
    await sendRequest<ExtensionResponse>({
      type: 'SET_SETTINGS',
      patch: { neverRunSites: [...DEFAULT_NEVER_RUN_SITES] },
    });
    neverRunArea.value = DEFAULT_NEVER_RUN_SITES.join('\n');
    return;
  }
  neverRunArea.value = settings.neverRunSites.join('\n');
}

let neverRunTimer: number | undefined;
neverRunArea.addEventListener('input', () => {
  window.clearTimeout(neverRunTimer);
  neverRunTimer = window.setTimeout(async () => {
    const lines = neverRunArea.value
      .split('\n')
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
    const res = await sendRequest<ExtensionResponse>({
      type: 'SET_SETTINGS',
      patch: { neverRunSites: lines },
    });
    if (res.type === 'SETTINGS') {
      sitesStatus.textContent = 'Saved.';
      sitesStatus.className = 'status ok';
    }
  }, 600);
});

void initNeverRun();

// ---------- Saved replies (P7.4) ----------

const replyList = document.getElementById('reply-list') as HTMLElement;
const replyTitle = document.getElementById('reply-title') as HTMLInputElement;
const replyText = document.getElementById('reply-text') as HTMLInputElement;
const replyAdd = document.getElementById('reply-add') as HTMLButtonElement;
const replyStatus = document.getElementById('reply-status') as HTMLParagraphElement;

let savedReplies: import('../shared/messages').SavedReply[] = [];

function renderReplies() {
  replyList.innerHTML = '';
  for (const r of savedReplies) {
    const row = document.createElement('div');
    row.className = 'tone-item';
    row.innerHTML = `<span class="name"></span><span class="instr"></span>`;
    (row.querySelector('.name') as HTMLElement).textContent = r.title;
    (row.querySelector('.instr') as HTMLElement).textContent = r.text;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'Delete';
    del.addEventListener('click', () => {
      savedReplies = savedReplies.filter((x) => x.id !== r.id);
      void saveReplies();
    });
    row.append(del);
    replyList.appendChild(row);
  }
}

async function saveReplies() {
  const res = await sendRequest<ExtensionResponse>({
    type: 'SET_SETTINGS',
    patch: { savedReplies },
  });
  if (res.type === 'SETTINGS') {
    savedReplies = res.settings.savedReplies;
    renderReplies();
    replyStatus.textContent = 'Saved.';
    replyStatus.className = 'status ok';
  }
}

replyAdd.addEventListener('click', () => {
  const title = replyTitle.value.trim();
  const text = replyText.value.trim();
  if (!title || !text) {
    replyStatus.textContent = 'Title and wording are required.';
    replyStatus.className = 'status err';
    return;
  }
  savedReplies = [...savedReplies, { id: crypto.randomUUID(), title, text }];
  replyTitle.value = '';
  replyText.value = '';
  void saveReplies();
});

// load saved replies alongside tones/voice
const _initReplies = async () => {
  const settings = await getSettings();
  savedReplies = settings.savedReplies ?? [];
  renderReplies();
};
void _initReplies();

// ---------- Optional key encryption (P8.7) ----------

const keyProtect = document.getElementById('key-protect') as HTMLElement;
const keyPass = document.getElementById('key-pass') as HTMLInputElement;
const keyUnlock = document.getElementById('key-unlock') as HTMLButtonElement;
const keyLock = document.getElementById('key-lock') as HTMLButtonElement;
const keyEncrypt = document.getElementById('key-encrypt') as HTMLButtonElement;
const keyStatusEl = document.getElementById('key-status') as HTMLElement;

async function refreshKeyState() {
  const res = (await sendRequest<ExtensionResponse>({ type: 'GET_KEY_STATE' })) as Extract<
    ExtensionResponse,
    { type: 'KEY_STATE' }
  >;
  if (res.type !== 'KEY_STATE') return;
  keyProtect.hidden = false;
  keyStatusEl.textContent = res.protected
    ? res.unlocked
      ? 'Key is encrypted and unlocked.'
      : 'Key is encrypted — enter your passphrase to unlock.'
    : 'Key stored unencrypted.';
  keyUnlock.hidden = !res.protected || res.unlocked;
  keyLock.hidden = !(res.protected && res.unlocked);
  keyEncrypt.hidden = res.protected;
}

keyEncrypt.addEventListener('click', async () => {
  const passphrase = keyPass.value;
  if (passphrase.length < 8) {
    keyStatusEl.textContent = 'Passphrase must be at least 8 characters.';
    keyStatusEl.className = 'status err';
    return;
  }
  const res = (await sendRequest<ExtensionResponse>({
    type: 'ENCRYPT_KEY',
    passphrase,
  })) as ExtensionResponse;
  if (res.type === 'KEY_STATE') {
    keyPass.value = '';
    keyStatusEl.textContent = 'Key encrypted.';
    keyStatusEl.className = 'status ok';
    await refreshKeyState();
  } else if (res.type === 'ERROR') {
    keyStatusEl.textContent = res.error.message;
    keyStatusEl.className = 'status err';
  }
});

keyUnlock.addEventListener('click', async () => {
  const res = (await sendRequest<ExtensionResponse>({
    type: 'UNLOCK_KEY',
    passphrase: keyPass.value,
  })) as ExtensionResponse;
  if (res.type === 'KEY_STATE') {
    keyPass.value = '';
    keyStatusEl.textContent = 'Unlocked.';
    keyStatusEl.className = 'status ok';
    await refreshKeyState();
  } else if (res.type === 'ERROR') {
    keyStatusEl.textContent = res.error.message;
    keyStatusEl.className = 'status err';
  }
});

keyLock.addEventListener('click', async () => {
  await sendRequest<ExtensionResponse>({ type: 'LOCK_KEY' });
  await refreshKeyState();
});

void refreshKeyState();

// ---------- Appearance theme ----------

const themeRadios = Array.from(
  document.querySelectorAll('input[name="app-theme"]'),
) as HTMLInputElement[];
const themeStatus = document.getElementById('theme-status') as HTMLElement;

function applyThemeAttr(mode: 'light' | 'dark') {
  document.documentElement.dataset.theme = mode;
}

async function initTheme() {
  const settings = await getSettings();
  const pref = settings.theme ?? 'auto';
  const radio = themeRadios.find((r) => r.value === pref);
  if (radio) radio.checked = true;
  applyThemeAttr(pref === 'dark' ? 'dark' : pref === 'light' ? 'light' : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  // keep auto in sync with system
  if (pref === 'auto') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      applyThemeAttr(e.matches ? 'dark' : 'light');
    });
  }
}

for (const r of themeRadios) {
  r.addEventListener('change', async () => {
    const pref = r.value as 'auto' | 'light' | 'dark';
    const res = await sendRequest<ExtensionResponse>({
      type: 'SET_SETTINGS',
      patch: { theme: pref },
    });
    if (res.type === 'SETTINGS') {
      applyThemeAttr(pref === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref);
      themeStatus.textContent = 'Saved.';
      themeStatus.className = 'status ok';
    }
  });
}
void initTheme();
