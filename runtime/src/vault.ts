// Company secrets: AES-256-GCM at rest, keyed by VAULT_KEY (32 bytes,
// base64). Values are decrypted only inside tool handlers and never
// returned to the model — redact() strips any stored value from text.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { all, one, run } from "./db.js";
import type { SecretResolver } from "./types.js";

function key(): Buffer {
  const raw = process.env.VAULT_KEY;
  if (!raw) throw new Error("VAULT_KEY is not set (32 random bytes, base64) — see .env.example");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("VAULT_KEY must decode to exactly 32 bytes");
  return k;
}

export function vaultConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function generateVaultKey(): string {
  return randomBytes(32).toString("base64");
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob: string): string {
  const [iv, tag, ct] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

export function setSecret(companyId: string, name: string, value: string): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`secret name must be UPPER_SNAKE: ${name}`);
  run(
    `INSERT INTO secrets (company_id, name, ciphertext, key_version, updated_at) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (company_id, name) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
    companyId,
    name,
    encrypt(value),
    Date.now(),
  );
}

export function deleteSecret(companyId: string, name: string): void {
  run("DELETE FROM secrets WHERE company_id = ? AND name = ?", companyId, name);
}

export function secretNames(companyId: string): string[] {
  return all<{ name: string }>("SELECT name FROM secrets WHERE company_id = ? ORDER BY name", companyId).map((r) => r.name);
}

/** Vault first, then process env (the .env portability contract). */
export function resolver(companyId: string): SecretResolver {
  const cache = new Map<string, string | undefined>();
  return {
    get(name) {
      if (cache.has(name)) return cache.get(name);
      const row = one<{ ciphertext: string }>("SELECT ciphertext FROM secrets WHERE company_id = ? AND name = ?", companyId, name);
      const v = row ? decrypt(row.ciphertext) : process.env[name];
      cache.set(name, v);
      return v;
    },
    names() {
      return secretNames(companyId);
    },
  };
}

/** Remove every known secret value from text before it reaches the model. */
export function redact(text: string, secrets: SecretResolver): string {
  let out = text;
  for (const name of secrets.names()) {
    const v = secrets.get(name);
    if (v && v.length >= 6) out = out.split(v).join(`[redacted:${name}]`);
  }
  return out;
}
