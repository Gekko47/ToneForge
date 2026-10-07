import { describe, expect, it } from "vitest";
import {
  decryptString,
  deriveDeviceKey,
  encryptString,
  generateDataKey,
  unwrapDataKey,
  wrapDataKey,
} from "../../../../../src/analysis/consistency/persistence/encryption";

describe("encryption", () => {
  describe("encryptString / decryptString", () => {
    it("round-trips a plaintext string", async () => {
      const key = await generateDataKey();
      const plaintext = "The delay is 42 days.";
      const payload = await encryptString(plaintext, key);
      const decrypted = await decryptString(payload, key);
      expect(decrypted).toBe(plaintext);
    });

    it("produces a different ciphertext each time", async () => {
      const key = await generateDataKey();
      const plaintext = "same text";
      const a = await encryptString(plaintext, key);
      const b = await encryptString(plaintext, key);
      expect(a.ciphertext).not.toBe(b.ciphertext);
    });

    it("fails to decrypt with a different key", async () => {
      const keyA = await generateDataKey();
      const keyB = await generateDataKey();
      const payload = await encryptString("secret", keyA);
      await expect(decryptString(payload, keyB)).rejects.toThrow();
    });
  });

  describe("wrapDataKey / unwrapDataKey", () => {
    it("round-trips a data key through the device key", async () => {
      const deviceKey = await deriveDeviceKey("passphrase", new Uint8Array(16).fill(1));
      const dataKey = await generateDataKey();
      const wrapped = await wrapDataKey(dataKey, deviceKey);
      const unwrapped = await unwrapDataKey(wrapped, deviceKey);
      const plaintext = "round-trip";
      const payload = await encryptString(plaintext, dataKey);
      const decrypted = await decryptString(payload, unwrapped);
      expect(decrypted).toBe(plaintext);
    });

    it("fails to unwrap with a different device key", async () => {
      const deviceKeyA = await deriveDeviceKey("passphrase", new Uint8Array(16).fill(1));
      const deviceKeyB = await deriveDeviceKey("passphrase", new Uint8Array(16).fill(2));
      const dataKey = await generateDataKey();
      const wrapped = await wrapDataKey(dataKey, deviceKeyA);
      await expect(unwrapDataKey(wrapped, deviceKeyB)).rejects.toThrow();
    });
  });

  describe("deriveDeviceKey", () => {
    it("is deterministic for a fixed passphrase and salt", async () => {
      const salt = new Uint8Array(16).fill(42);
      const keyA = await deriveDeviceKey("secret", salt);
      const keyB = await deriveDeviceKey("secret", salt);
      const payload = await encryptString("test", keyA);
      const decrypted = await decryptString(payload, keyB);
      expect(decrypted).toBe("test");
    });

    it("produces a different key for a different salt", async () => {
      const keyA = await deriveDeviceKey("secret", new Uint8Array(16).fill(1));
      const keyB = await deriveDeviceKey("secret", new Uint8Array(16).fill(2));
      const payload = await encryptString("test", keyA);
      await expect(decryptString(payload, keyB)).rejects.toThrow();
    });
  });
});
