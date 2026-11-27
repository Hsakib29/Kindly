import { SETTINGS_DEFAULTS, type Settings } from './messages';

const SETTINGS_KEY = 'settings';
const API_KEY_KEY = 'apiKey';

function storageGet<T>(keys: string | string[] | Record<string, unknown>): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolvePromise(result as T);
    });
  });
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    chrome.storage.local.set(items, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolvePromise();
    });
  });
}

export async function getSettings(): Promise<Settings> {
  // chrome.storage.local.get returns { settings: <value> }, not the value itself.
  const stored = await storageGet<Record<string, Partial<Settings>>>(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] ?? {};
  return {
    ...SETTINGS_DEFAULTS,
    ...settings,
    schemaVersion: SETTINGS_DEFAULTS.schemaVersion,
    brandVoice: { ...SETTINGS_DEFAULTS.brandVoice, ...settings.brandVoice },
    usePageContextBySite: {
      ...SETTINGS_DEFAULTS.usePageContextBySite,
      ...settings.usePageContextBySite,
    },
  };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = { ...current, ...patch, schemaVersion: current.schemaVersion };
  await storageSet({ [SETTINGS_KEY]: next });
  return next;
}

export async function getKey(): Promise<string | null> {
  const stored = await storageGet<Record<string, string>>(API_KEY_KEY);
  return stored[API_KEY_KEY] ?? null;
}

export async function setKey(key: string): Promise<void> {
  await storageSet({ [API_KEY_KEY]: key });
}

export async function clearKey(): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    chrome.storage.local.remove(API_KEY_KEY, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolvePromise();
    });
  });
}

// ---------- Raw key storage (P8.7: plaintext OR encrypted blob) ----------

import type { EncryptedKeyBlob } from './crypto';

export type StoredKey = string | EncryptedKeyBlob;

export function isEncryptedKey(v: unknown): v is EncryptedKeyBlob {
  return typeof v === 'object' && v !== null && 'salt' in v && 'iv' in v && 'ct' in v;
}

export async function getStoredKey(): Promise<StoredKey | null> {
  const stored = await storageGet<Record<string, StoredKey>>(API_KEY_KEY);
  return stored[API_KEY_KEY] ?? null;
}

export async function setStoredKey(value: StoredKey): Promise<void> {
  await storageSet({ [API_KEY_KEY]: value });
}
