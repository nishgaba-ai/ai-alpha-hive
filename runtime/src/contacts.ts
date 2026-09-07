// Known contacts: the gate treats a `send` to an address the company has
// already written to as a reply (policy send.reply, allowed by default)
// and anything else as first contact (send.first_contact, parks by
// default). Every send-class tool records its recipients here after a
// successful send so the second message in a thread does not park again.

import { all, one, run } from "./db.js";

export function knownContact(companyId: string, address: string): boolean {
  return !!one("SELECT 1 FROM contacts WHERE company_id = ? AND address = ?", companyId, address.toLowerCase());
}

export function knownContacts(companyId: string): string[] {
  return all<{ address: string }>("SELECT address FROM contacts WHERE company_id = ?", companyId).map((r) => r.address);
}

/** Idempotent. Addresses are emails, phone numbers in E.164, handles, or provider ids; stored lower-cased. */
export function rememberContact(companyId: string, address: string | string[]): void {
  for (const a of ([] as string[]).concat(address)) {
    if (!a) continue;
    run("INSERT OR IGNORE INTO contacts (company_id, address, first_contact_at) VALUES (?, ?, ?)", companyId, a.toLowerCase(), Date.now());
  }
}
