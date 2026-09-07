// HubSpot — the CRM. A private-app token scoped to contacts, deals and
// notes. Keeping records current is `write` class (nobody is contacted),
// so the sales role maintains the pipeline without approvals; outreach
// itself still goes through email.send, which parks first contact.

import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";
import type { ToolResult } from "../../src/types.js";

const API = "https://api.hubapi.com";
const CONTACT_PROPS = ["email", "firstname", "lastname", "phone", "company", "lifecyclestage"];
const DEAL_PROPS = ["dealname", "amount", "dealstage", "pipeline", "closedate", "createdate"];
/** HubSpot-defined association type ids */
const DEAL_TO_CONTACT = 3;
const NOTE_TO_CONTACT = 202;

type Json = Record<string, unknown>;
type HsObject = { id: string; properties?: Record<string, string | null>; createdAt?: string; updatedAt?: string };

async function hs(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as Json;
  return { ok: res.ok, status: res.status, body };
}
const err = (r: { status: number; body: Json }): ToolResult => fail("hubspot_error", String(r.body.message ?? `HTTP ${r.status}`), { status: r.status, category: r.body.category });
const missing = () => fail("missing_secret", "HUBSPOT_TOKEN is not in the vault (HubSpot → Settings → Integrations → Private Apps)");
const lim = (v: unknown, d: number) => Math.max(1, Math.min(Number(v ?? d) || d, 100));
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

function contact(o: HsObject) {
  const p = o.properties ?? {};
  return { id: o.id, email: p.email ?? null, firstname: p.firstname ?? null, lastname: p.lastname ?? null, phone: p.phone ?? null, company: p.company ?? null, lifecyclestage: p.lifecyclestage ?? null };
}
function deal(o: HsObject) {
  const p = o.properties ?? {};
  return { id: o.id, name: p.dealname ?? null, amount: p.amount ? Number(p.amount) : null, stage: p.dealstage ?? null, pipeline: p.pipeline ?? null, close_date: p.closedate ?? null, created_at: p.createdate ?? o.createdAt ?? null };
}
const assoc = (id: string, typeId: number) => [{ to: { id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }] }];

export default defineIntegration({
  id: "hubspot",
  auth: { kind: "api_key", guide: "HubSpot → Settings → Integrations → Private Apps → Create a private app → Scopes: crm.objects.contacts (read, write), crm.objects.deals (read, write) → Create → copy the access token (pat-…)." },
  title: "HubSpot",
  description: "CRM contacts, deals and notes: search and create contacts, keep the pipeline current, log notes against people.",
  website: "https://developers.hubspot.com/docs/api/crm/contacts",
  guidance: `
## What it does
- **read** — \`hubspot.search_contacts\` finds people by name, email or company; \`hubspot.deals\` lists deals (optionally in one stage) with amount, stage and close date.
- **write** — \`hubspot.create_contact\` and \`hubspot.update_contact\` keep people current; \`hubspot.create_deal\` opens a deal (associated with a contact when given); \`hubspot.add_note\` logs a note on a contact's timeline.

CRM records are internal, so both modes are \`read\`/\`write\` class and run without approvals. Contacting someone is not done here: use \`email.send\` (first contact parks for the board) and then log the outcome with \`hubspot.add_note\`.

## Connecting
1. HubSpot → **Settings → Integrations → Private Apps → Create a private app**. Scopes: \`crm.objects.contacts.read\`, \`crm.objects.contacts.write\`, \`crm.objects.deals.read\`, \`crm.objects.deals.write\` (notes use the contacts scopes).
2. Copy the **access token** (\`pat-…\`) → \`HUBSPOT_TOKEN\`.
3. Run the healthcheck; \`hubspot.deals\` shows the stage ids your pipeline uses (\`create_deal\` needs one).

## Enabling
\`\`\`yaml
integrations:
  - id: hubspot
    modes: [read, write]
roles:
  - id: sales
    tools: [hubspot.*, email.send]
\`\`\`
`,
  secrets: [
    { name: "HUBSPOT_TOKEN", description: "Private app access token (pat-…)", obtain: "HubSpot → Settings → Integrations → Private Apps → your app → Auth" },
  ],
  modes: [
    { id: "read", title: "Read", description: "Search contacts, list deals", sideEffect: "read" },
    { id: "write", title: "Write", description: "Create and update contacts, deals and notes", sideEffect: "write" },
  ],
  methods: [
    {
      name: "search_contacts", mode: "read",
      description: "Search contacts by free text (name, email, company, phone).",
      input: strictSchema({ query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["query"]),
      async handler(ctx, input) {
        const token = ctx.secrets.get("HUBSPOT_TOKEN");
        if (!token) return missing();
        const r = await hs(token, "/crm/v3/objects/contacts/search", { method: "POST", body: JSON.stringify({ query: String(input.query), limit: lim(input.limit, 10), properties: CONTACT_PROPS }) });
        if (!r.ok) return err(r);
        return { ok: true, total: r.body.total ?? 0, contacts: ((r.body.results as HsObject[]) ?? []).map(contact) };
      },
    },
    {
      name: "create_contact", mode: "write",
      description: "Create a contact. properties adds any other HubSpot contact property (internal names, e.g. jobtitle, website).",
      input: strictSchema(
        {
          email: { type: "string" },
          firstname: { type: "string" },
          lastname: { type: "string" },
          phone: { type: "string" },
          company: { type: "string" },
          properties: { type: "object", description: "extra properties by internal name" },
        },
        ["email"],
      ),
      async handler(ctx, input) {
        const token = ctx.secrets.get("HUBSPOT_TOKEN");
        if (!token) return missing();
        const properties = defined({ ...((input.properties as Json) ?? {}), email: input.email, firstname: input.firstname, lastname: input.lastname, phone: input.phone, company: input.company });
        const r = await hs(token, "/crm/v3/objects/contacts", { method: "POST", body: JSON.stringify({ properties }) });
        if (r.status === 409) return fail("exists", `${String(r.body.message ?? "contact already exists")}; use hubspot.update_contact`);
        if (!r.ok) return err(r);
        return { ok: true, contact_id: r.body.id, created_at: r.body.createdAt };
      },
    },
    {
      name: "update_contact", mode: "write",
      description: "Update contact properties by internal name (e.g. {\"lifecyclestage\": \"lead\", \"phone\": \"+91…\"}).",
      input: strictSchema({ contact_id: { type: "string" }, properties: { type: "object" } }),
      async handler(ctx, input) {
        const token = ctx.secrets.get("HUBSPOT_TOKEN");
        if (!token) return missing();
        const r = await hs(token, `/crm/v3/objects/contacts/${encodeURIComponent(String(input.contact_id))}`, { method: "PATCH", body: JSON.stringify({ properties: input.properties ?? {} }) });
        if (!r.ok) return err(r);
        return { ok: true, contact_id: r.body.id, updated_at: r.body.updatedAt, contact: contact(r.body as unknown as HsObject) };
      },
    },
    {
      name: "deals", mode: "read",
      description: "Deals, most recently modified first; stage narrows to one dealstage id. amount is as HubSpot stores it (major units of the portal currency).",
      input: strictSchema({ stage: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, []),
      async handler(ctx, input) {
        const token = ctx.secrets.get("HUBSPOT_TOKEN");
        if (!token) return missing();
        const body: Json = { limit: lim(input.limit, 20), properties: DEAL_PROPS, sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }] };
        if (input.stage) body.filterGroups = [{ filters: [{ propertyName: "dealstage", operator: "EQ", value: String(input.stage) }] }];
        const r = await hs(token, "/crm/v3/objects/deals/search", { method: "POST", body: JSON.stringify(body) });
        if (!r.ok) return err(r);
        return { ok: true, total: r.body.total ?? 0, deals: ((r.body.results as HsObject[]) ?? []).map(deal) };
      },
    },
    {
      name: "create_deal", mode: "write",
      description: "Create a deal (amount in major units as HubSpot expects; stage is a dealstage id, which most portals require) and associate it with a contact when contact_id is given.",
      input: strictSchema(
        {
          name: { type: "string", maxLength: 200 },
          amount: { type: "number" },
          stage: { type: "string", description: "dealstage id" },
          pipeline: { type: "string", description: "pipeline id (default pipeline when omitted)" },
          contact_id: { type: "string" },
        },
        ["name"],
      ),
      async handler(ctx, input) {
        const token = ctx.secrets.get("HUBSPOT_TOKEN");
        if (!token) return missing();
        const properties = defined({ dealname: input.name, amount: input.amount, dealstage: input.stage, pipeline: input.pipeline });
        const body: Json = { properties };
        if (input.contact_id) body.associations = assoc(String(input.contact_id), DEAL_TO_CONTACT);
        const r = await hs(token, "/crm/v3/objects/deals", { method: "POST", body: JSON.stringify(body) });
        if (!r.ok) return err(r);
        return { ok: true, deal_id: r.body.id, contact_id: input.contact_id ?? null };
      },
    },
    {
      name: "add_note", mode: "write",
      description: "Log a note on a contact's timeline (call summary, meeting outcome, next step).",
      input: strictSchema({ contact_id: { type: "string" }, body: { type: "string", maxLength: 65_000 } }),
      async handler(ctx, input) {
        const token = ctx.secrets.get("HUBSPOT_TOKEN");
        if (!token) return missing();
        const body = { properties: { hs_timestamp: new Date().toISOString(), hs_note_body: String(input.body) }, associations: assoc(String(input.contact_id), NOTE_TO_CONTACT) };
        const r = await hs(token, "/crm/v3/objects/notes", { method: "POST", body: JSON.stringify(body) });
        if (!r.ok) return err(r);
        return { ok: true, note_id: r.body.id, contact_id: input.contact_id };
      },
    },
  ],
  async healthcheck(ctx) {
    const token = ctx.secrets.get("HUBSPOT_TOKEN");
    if (!token) return { ok: false, detail: "HUBSPOT_TOKEN missing" };
    const r = await hs(token, "/crm/v3/objects/contacts?limit=1");
    return r.ok ? { ok: true, detail: "token accepted; contacts readable" } : { ok: false, detail: String(r.body.message ?? `rejected (HTTP ${r.status})`) };
  },
});
