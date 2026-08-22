import { randomBytes, randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID().replace(/-/g, "");
}

// 256-bit opaque secret for sessions and one-time tokens (spec §6, §11)
export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}
