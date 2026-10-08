/**
 * WebCrypto AES-GCM field encryption (R7, D2).
 *
 * Per-document data key generated per review session, wrapped by a device key.
 * Evidence text, claim text, and decision prompts encrypted at field level;
 * hashes, IDs, versions, and counts stay plaintext for indexing.
 *
 * No credential ever stored — ProviderConnection.ts rule unchanged.
 */

/** Encrypted payload with nonce for AES-GCM decryption. */
export interface EncryptedPayload {
  readonly ciphertext: string;
  readonly nonce: string;
}

const AES_KEY_LENGTH = 256;
const AES_IV_LENGTH = 12;

function getCrypto(): Crypto {
  if (globalThis.crypto === undefined) {
    throw new Error("WebCrypto is not available in this environment.");
  }
  return globalThis.crypto;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  Array.from(binary).forEach((char, i) => {
    bytes[i] = char.charCodeAt(0);
  });
  return bytes;
}

/**
 * Generate a new AES-GCM data key for one review session.
 * The key is ephemeral: loss equals wipe, which is the safe failure.
 */
export async function generateDataKey(): Promise<CryptoKey> {
  // extractable: true — the data key must be exportable so wrapDataKey can
  // wrap it with the device key for storage. The wrapped form is what gets
  // persisted; the raw key is never stored.
  return getCrypto().subtle.generateKey({ name: "AES-GCM", length: AES_KEY_LENGTH }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Wrap a data key with the device key using AES-GCM.
 * The wrapped key is stored alongside the ciphertext; the device key
 * never leaves this module.
 */
export async function wrapDataKey(
  dataKey: CryptoKey,
  deviceKey: CryptoKey,
): Promise<EncryptedPayload> {
  const iv = getCrypto().getRandomValues(new Uint8Array(AES_IV_LENGTH));
  const exported = await getCrypto().subtle.exportKey("raw", dataKey);
  const wrapped = await getCrypto().subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    deviceKey,
    exported,
  );
  return {
    ciphertext: toBase64(new Uint8Array(wrapped)),
    nonce: toBase64(iv),
  };
}

/**
 * Unwrap a data key with the device key.
 */
export async function unwrapDataKey(
  wrapped: EncryptedPayload,
  deviceKey: CryptoKey,
): Promise<CryptoKey> {
  const iv = fromBase64(wrapped.nonce);
  const ciphertext = fromBase64(wrapped.ciphertext);
  const unwrapped = await getCrypto().subtle.decrypt(
    { name: "AES-GCM", iv },
    deviceKey,
    ciphertext,
  );
  return getCrypto().subtle.importKey(
    "raw",
    unwrapped,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a UTF-8 string with AES-GCM.
 *
 * `additionalData` is optional authenticated data (AAD). When provided, it is
 * bound into the ciphertext: decryption fails if the same AAD is not supplied.
 * This binds the ciphertext to a context (e.g. a document revision) so it
 * cannot be replayed against a different context.
 */
export async function encryptString(
  plaintext: string,
  key: CryptoKey,
  additionalData?: string,
): Promise<EncryptedPayload> {
  const iv = getCrypto().getRandomValues(new Uint8Array(AES_IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const aad = additionalData !== undefined ? new TextEncoder().encode(additionalData) : undefined;
  const ciphertext = await getCrypto().subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource | undefined },
    key,
    encoded,
  );
  return {
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    nonce: toBase64(iv),
  };
}

/**
 * Decrypt an AES-GCM encrypted string.
 *
 * `additionalData` must match the value supplied at encryption time, or
 * decryption fails. This is the mechanism that binds ciphertext to a context.
 */
export async function decryptString(
  payload: EncryptedPayload,
  key: CryptoKey,
  additionalData?: string,
): Promise<string> {
  const iv = fromBase64(payload.nonce);
  const ciphertext = fromBase64(payload.ciphertext);
  const aad = additionalData !== undefined ? new TextEncoder().encode(additionalData) : undefined;
  const decrypted = await getCrypto().subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad as BufferSource | undefined },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Derive a device key from a passphrase using PBKDF2.
 * The device key wraps per-document data keys and is never persisted.
 */
export async function deriveDeviceKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(passphrase);
  const baseKey = await getCrypto().subtle.importKey("raw", encoded, "PBKDF2", false, [
    "deriveKey",
  ]);
  return getCrypto().subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100_000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}
