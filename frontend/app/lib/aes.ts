/**
 * AES-256-GCM bulk encryption helpers — the "fast lane" of the hybrid
 * Seal/AES encryption scheme used by the AI batch blobs.
 *
 * # Why AES-GCM at all (and not pure Seal)
 *
 * Seal encrypts via threshold key servers — every byte of plaintext
 * has to be encrypted server-side, which is bandwidth-heavy and costs
 * key-server fees. For a JSON payload that contains N markets'
 * `MatchAnalysis` records (a few KB at most, but still), this is
 * wasteful.
 *
 * Standard hybrid pattern:
 *   1. Generate a random 32-byte AES-256 key.
 *   2. AES-encrypt the bulk JSON with that key (fast, local).
 *   3. Seal-encrypt ONLY the 32-byte AES key with the pool's namespace
 *      (one tiny payload — fast, cheap).
 *   4. Embed both in the same Walrus blob as base64.
 *
 * Decrypt mirrors it:
 *   1. Seal-decrypt the wrapped key (only stakers in the right pool
 *      can do this — same gate as before).
 *   2. AES-decrypt the payload with the recovered key.
 *
 * The access gate is preserved (you still need a valid pool
 * subscription to recover the AES key) while halving Walrus uploads
 * (one blob per batch instead of two) and keeping the cost of
 * Seal's key-server roundtrip proportional to 32 bytes instead of
 * the full insight payload.
 *
 * # Wire format
 *
 * `encrypt()` returns a base64 string of `[12-byte IV][ciphertext+tag]`.
 * The 16-byte GCM auth tag is appended by Web Crypto automatically.
 * We prepend the IV so a single base64 string carries everything the
 * decrypt side needs — no separate `iv` field on the BatchInsight.
 *
 * # Web Crypto availability
 *
 * `crypto.subtle` is available in browsers over HTTPS and in Node ≥ 19
 * globally. Walrus-uploads come from the browser (Tatum upload is a
 * fetch call from the user's machine), so this is fine for both the
 * encrypt-time path (in `ai-batch-store`) and the decrypt-time path
 * (in `useSealDecrypt`).
 */

const ALG = 'AES-GCM';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit IV — GCM standard

/**
 * Generate a fresh AES-256-GCM key.
 */
export async function generateAesKey(): Promise<Uint8Array> {
  const key = await crypto.subtle.generateKey(
    { name: ALG, length: KEY_BYTES * 8 },
    true, // extractable — we hand the raw bytes to Seal next
    ['encrypt', 'decrypt'],
  );
  const raw = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(raw);
}

/**
 * Encrypt `plaintext` with `key` (32 raw bytes). Returns a base64
 * string of `[IV || ciphertext || tag]` — the 16-byte GCM tag is
 * appended by Web Crypto.
 *
 * Each call uses a fresh random 12-byte IV. NEVER reuse a key/IV
 * pair with GCM (catastrophic for the security of every other
 * message under the same key).
 */
export async function aesEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
): Promise<string> {
  if (key.byteLength !== KEY_BYTES) {
    throw new Error(
      `AES key must be ${KEY_BYTES} bytes (got ${key.byteLength})`,
    );
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    copyToFreshBuffer(key),
    { name: ALG },
    false,
    ['encrypt'],
  );
  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: ALG, iv },
    cryptoKey,
    copyToFreshBuffer(plaintext),
  );
  // Web Crypto returns ciphertext || 16-byte GCM tag concatenated.
  const out = new Uint8Array(IV_BYTES + ciphertextWithTag.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertextWithTag), IV_BYTES);
  return toBase64(out);
}

/**
 * Decrypt a payload produced by `aesEncrypt`. Throws if the auth tag
 * fails verification — this is what binds the ciphertext to the
 * (key, IV) pair and rejects any tampering.
 *
 * Returns the plaintext bytes; caller is responsible for
 * `TextDecoder` + `JSON.parse` if they want a JS object.
 */
export async function aesDecrypt(payloadB64: string, key: Uint8Array): Promise<Uint8Array> {
  if (key.byteLength !== KEY_BYTES) {
    throw new Error(
      `AES key must be ${KEY_BYTES} bytes (got ${key.byteLength})`,
    );
  }
  const buf = fromBase64(payloadB64);
  if (buf.byteLength < IV_BYTES + 16) {
    // 16 = minimum GCM tag size; any valid payload must include it.
    throw new Error('AES payload too short (missing IV or auth tag)');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const ciphertextWithTag = buf.subarray(IV_BYTES);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    copyToFreshBuffer(key),
    { name: ALG },
    false,
    ['decrypt'],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: ALG, iv: copyToFreshBuffer(iv) },
    cryptoKey,
    copyToFreshBuffer(ciphertextWithTag),
  );
  return new Uint8Array(plaintext);
}

/**
 * Copy a `Uint8Array` into a freshly-allocated `ArrayBuffer`-backed
 * view. Web Crypto's TS 5.x typings reject views backed by a generic
 * `ArrayBufferLike` (could be `SharedArrayBuffer`); copying sidesteps
 * the variance issue without changing runtime behaviour.
 */
function copyToFreshBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return out;
}

// ─── Base64 helpers ─────────────────────────────────────────────────────
//
// We use Web's `btoa`/`atob` only for ASCII input — for arbitrary bytes
// (binary ciphertext) we round-trip via a string of char codes.

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}