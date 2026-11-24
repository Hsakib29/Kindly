// Optional API-key encryption at rest (P8.7).
// AES-256-GCM with a PBKDF2-derived key. The passphrase is never stored —
// only asked once per browser session (the derived CryptoKey lives in
// chrome.storage.session, which clears when the browser closes).

export interface EncryptedKeyBlob {
  /** PBKDF2 salt, base64. */
  salt: string;
  /** AES-GCM IV, base64. */
  iv: string;
  /** Ciphertext, base64. */
  ct: string;
  /** KDF version: absent/1 = 100k iterations, 2 = 600k. */
  v?: number;
}

// K-17: v1 blobs (no v field) keep 100k; new blobs use 600k (OWASP
// guidance for PBKDF2-SHA256).
const PBKDF2_ITERATIONS_V1 = 100_000;
const PBKDF2_ITERATIONS_V2 = 600_000;

function iterationsFor(blob: EncryptedKeyBlob): number {
  return blob.v === 2 ? PBKDF2_ITERATIONS_V2 : PBKDF2_ITERATIONS_V1;
}
const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    true, // extractable so it can be cached in chrome.storage.session
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSecret(
  plaintext: string,
  passphrase: string,
  /** Test hook: override iteration count (v1 blobs = 100_000). */
  iterations: number = PBKDF2_ITERATIONS_V2,
): Promise<EncryptedKeyBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    enc.encode(plaintext),
  );
  return {
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(ct),
    // v2 = 600k iterations; legacy 100k blobs are written without v.
    ...(iterations >= PBKDF2_ITERATIONS_V2 ? { v: 2 } : {}),
  };
}

/** Throws if the passphrase is wrong (GCM auth failure). */
export async function decryptSecret(
  blob: EncryptedKeyBlob,
  passphrase: string,
): Promise<string> {
  const key = await deriveKey(passphrase, fromB64(blob.salt), iterationsFor(blob));
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) as BufferSource },
    key,
    fromB64(blob.ct) as BufferSource,
  );
  return dec.decode(pt);
}

/** Re-derive the CryptoKey for session caching (same params as decrypt). */
export async function deriveSessionKey(
  blob: EncryptedKeyBlob,
  passphrase: string,
): Promise<CryptoKey> {
  // K-17: derive ONCE — verify by decrypting with that same key, then
  // return it. (Was: decryptSecret + deriveKey = two derivations.)
  const key = await deriveKey(passphrase, fromB64(blob.salt), iterationsFor(blob));
  await decryptWithKey(blob, key); // throws on wrong passphrase
  return key;
}

/** Export a CryptoKey as JWK so it survives chrome.storage's JSON serialization. */
export async function exportKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', key);
}

/** Re-import a JWK exported by exportKeyJwk (AES-GCM, non-extractable). */
export async function importKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function decryptWithKey(
  blob: EncryptedKeyBlob,
  key: CryptoKey,
): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) as BufferSource },
    key,
    fromB64(blob.ct) as BufferSource,
  );
  return dec.decode(pt);
}
