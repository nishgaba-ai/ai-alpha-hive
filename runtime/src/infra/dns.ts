// DNS providers behind infra.dns.set. Cloudflare first (prodigalai.com
// lives there); the interface leaves room for others. Secrets in the vault:
//   CLOUDFLARE_API_TOKEN   scoped to Zone:DNS:Edit for the zones the company owns

import type { SecretResolver } from "../types.js";

export type DnsRecord = { type: "A" | "AAAA" | "CNAME" | "TXT" | "MX"; name: string; content: string; ttl?: number; proxied?: boolean; priority?: number };

export interface DnsProvider {
  id: string;
  requiredSecrets: string[];
  /** Upsert one record on the zone that contains `domain`. */
  set(secrets: SecretResolver, domain: string, record: DnsRecord): Promise<{ id: string; zone: string }>;
  list(secrets: SecretResolver, domain: string): Promise<DnsRecord[]>;
}

const CF = "https://api.cloudflare.com/client/v4";

async function cf<T>(secrets: SecretResolver, method: string, path: string, body?: unknown): Promise<T> {
  const token = secrets.get("CLOUDFLARE_API_TOKEN") ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN missing from the vault");
  const res = await fetch(`${CF}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json()) as { success: boolean; result: T; errors?: { message: string }[] };
  if (!res.ok || !json.success) throw new Error(`cloudflare ${path}: ${json.errors?.map((e) => e.message).join("; ") ?? res.status}`);
  return json.result;
}

/** The zone is the longest registered suffix of the domain that Cloudflare knows. */
async function zoneFor(secrets: SecretResolver, domain: string): Promise<{ id: string; name: string }> {
  const labels = domain.toLowerCase().split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    const zones = await cf<{ id: string; name: string }[]>(secrets, "GET", `/zones?name=${encodeURIComponent(candidate)}&status=active`);
    if (zones.length) return zones[0];
  }
  throw new Error(`no Cloudflare zone for ${domain}`);
}

export const cloudflare: DnsProvider = {
  id: "cloudflare",
  requiredSecrets: ["CLOUDFLARE_API_TOKEN"],
  async set(secrets, domain, record) {
    const zone = await zoneFor(secrets, domain);
    const name = record.name === "@" ? zone.name : record.name.includes(".") ? record.name : `${record.name}.${zone.name}`;
    const existing = await cf<{ id: string }[]>(secrets, "GET", `/zones/${zone.id}/dns_records?type=${record.type}&name=${encodeURIComponent(name)}`);
    const payload = { type: record.type, name, content: record.content, ttl: record.ttl ?? 1, proxied: record.type === "A" || record.type === "AAAA" || record.type === "CNAME" ? record.proxied ?? true : undefined, priority: record.priority };
    const r = existing.length
      ? await cf<{ id: string }>(secrets, "PUT", `/zones/${zone.id}/dns_records/${existing[0].id}`, payload)
      : await cf<{ id: string }>(secrets, "POST", `/zones/${zone.id}/dns_records`, payload);
    return { id: r.id, zone: zone.name };
  },
  async list(secrets, domain) {
    const zone = await zoneFor(secrets, domain);
    const rows = await cf<{ type: DnsRecord["type"]; name: string; content: string; ttl: number; proxied?: boolean; priority?: number }[]>(secrets, "GET", `/zones/${zone.id}/dns_records?per_page=100`);
    return rows.map((r) => ({ type: r.type, name: r.name, content: r.content, ttl: r.ttl, proxied: r.proxied, priority: r.priority }));
  },
};

export function dnsProvider(secrets: SecretResolver): DnsProvider | null {
  if (secrets.get("CLOUDFLARE_API_TOKEN") ?? process.env.CLOUDFLARE_API_TOKEN) return cloudflare;
  return null;
}
