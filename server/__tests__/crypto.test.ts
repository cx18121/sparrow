import { describe, it, expect, beforeEach, afterEach } from "vitest";

// We need to reset the cached key between tests that manipulate ENCRYPTION_KEY.
// The module uses a module-level `cachedKey` variable, so we need to re-import
// after clearing the cache. We achieve this via vi.resetModules() + dynamic import.

describe("crypto — encrypt / decrypt", () => {
  const VALID_KEY = "test-secret-key-for-unit-tests-only";

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
    // Force module to re-evaluate so cachedKey starts fresh each test.
    // (vi.resetModules clears the module registry; dynamic import fetches fresh)
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it("encrypt returns a string in iv.authTag.ciphertext (3-dot-separated) format", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    process.env.ENCRYPTION_KEY = VALID_KEY;
    const { encrypt } = await import("../lib/crypto.js");
    const result = encrypt("hello world");
    const parts = result.split(".");
    expect(parts).toHaveLength(3);
    // Each part should be non-empty base64
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0);
      expect(() => Buffer.from(part, "base64")).not.toThrow();
    }
  });

  it("decrypt(encrypt(x)) === x (round-trip)", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    process.env.ENCRYPTION_KEY = VALID_KEY;
    const { encrypt, decrypt } = await import("../lib/crypto.js");
    const original = "sensitive data 🔑";
    const ciphertext = encrypt(original);
    const plaintext = decrypt(ciphertext);
    expect(plaintext).toBe(original);
  });

  it("encrypt produces different ciphertext each call (random IV)", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    process.env.ENCRYPTION_KEY = VALID_KEY;
    const { encrypt } = await import("../lib/crypto.js");
    const msg = "same input";
    const c1 = encrypt(msg);
    const c2 = encrypt(msg);
    expect(c1).not.toBe(c2);
  });

  it("decrypt throws on malformed payload (missing dots)", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    process.env.ENCRYPTION_KEY = VALID_KEY;
    const { decrypt } = await import("../lib/crypto.js");
    expect(() => decrypt("notvalid")).toThrow("Malformed ciphertext");
    expect(() => decrypt("only.twoParts")).toThrow("Malformed ciphertext");
  });

  it("encrypt throws when ENCRYPTION_KEY env var is not set", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env.ENCRYPTION_KEY;
    const { encrypt } = await import("../lib/crypto.js");
    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY is not set");
  });

  it("decrypt throws when ENCRYPTION_KEY env var is not set", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    delete process.env.ENCRYPTION_KEY;
    const { decrypt } = await import("../lib/crypto.js");
    expect(() => decrypt("a.b.c")).toThrow("ENCRYPTION_KEY is not set");
  });
});
