// Google Calendar — list events, check free/busy, and schedule meetings
// (with a Meet link and invitations) on the connected account's calendars.
// Scheduling is send-class because invitations go out to attendees: the
// first invite to a new address parks for the board like a first email.
// Uses the shared Google connection (prefix GOOGLE).

import { randomUUID } from "node:crypto";
import { defineIntegration, strictSchema, fail, type OAuthConfig } from "../../src/integrations/registry.js";
import { ensureToken } from "../../src/oauth.js";
import { rememberContact } from "../../src/contacts.js";
import type { ToolContext, ToolResult } from "../../src/types.js";

export const AUTH: OAuthConfig = {
  kind: "oauth2",
  prefix: "GOOGLE",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: ["https://www.googleapis.com/auth/calendar"],
  tokenAuth: "body",
  extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  guide: "console.cloud.google.com → APIs & Services → enable Google Calendar API → Credentials → OAuth client (Web application) → Authorized redirect URIs = the one shown here; copy Client ID and Client Secret. One Google connection serves GA4, Search Console, Drive, Sheets, Calendar, Gmail and YouTube.",
};

const CAL = "https://www.googleapis.com/calendar/v3";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const enc = encodeURIComponent;

type Json = Record<string, unknown>;
type Ctx = Pick<ToolContext, "company" | "secrets">;

function notConnected(): ToolResult {
  return fail("not_connected", "Connect Google on the Integrations screen (Calendar needs the OAuth connection; service accounts cannot see a person's calendar)");
}

/** Token from the shared Google connection. Fails before any network call when not connected. */
async function accessToken(ctx: Ctx): Promise<string | ToolResult> {
  if (!ctx.secrets.get("GOOGLE_ACCESS_TOKEN") && !ctx.secrets.get("GOOGLE_REFRESH_TOKEN")) return notConnected();
  try {
    const token = await ensureToken(ctx.company.id, ctx.secrets, AUTH);
    return token ?? notConnected();
  } catch (e) {
    return fail("auth_error", (e as Error).message);
  }
}

async function gapi(token: string, url: string, method: "GET" | "POST" = "GET", json?: unknown): Promise<{ ok: boolean; status: number; body: Json }> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(json === undefined ? {} : { "Content-Type": "application/json" }) },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  return { ok: res.ok, status: res.status, body };
}

function errorMessage(r: { status: number; body: Json }): string {
  const message = (r.body.error as { message?: string } | undefined)?.message ?? `HTTP ${r.status}`;
  if (r.status === 401) return `${message} — token rejected; reconnect Google`;
  if (r.status === 403) return `${message} — is the Calendar API enabled, and was Calendar included when Google was connected?`;
  if (r.status === 404) return `${message} — check calendar_id (an email address, or "primary")`;
  return message;
}
function calendarError(r: { status: number; body: Json }): ToolResult {
  return fail("calendar_error", errorMessage(r));
}

/** RFC 3339 timestamp from a date, a datetime, or nothing (fallback). undefined = unparseable. */
function iso(v: unknown, fallback: () => Date): string | undefined {
  if (v === undefined || v === null || v === "") return fallback().toISOString();
  const s = String(v).trim();
  const d = DATE_ONLY.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Event start/end: YYYY-MM-DD is all-day; otherwise RFC 3339 with an offset, or a time_zone to interpret it in. */
function when(v: unknown, tz: string | undefined): { date: string } | { dateTime: string; timeZone?: string } | undefined {
  const s = String(v ?? "").trim();
  if (DATE_ONLY.test(s)) return { date: s };
  if (!s || Number.isNaN(Date.parse(s))) return undefined;
  if (!tz && !HAS_OFFSET.test(s)) return undefined;
  return tz ? { dateTime: s, timeZone: tz } : { dateTime: s };
}

function eventOut(e: Json) {
  const start = e.start as { dateTime?: string; date?: string } | undefined;
  const end = e.end as { dateTime?: string; date?: string } | undefined;
  return {
    id: e.id,
    title: e.summary,
    start: start?.dateTime ?? start?.date,
    end: end?.dateTime ?? end?.date,
    all_day: !!start?.date,
    location: e.location,
    description: typeof e.description === "string" ? e.description.slice(0, 500) : undefined,
    organizer: (e.organizer as { email?: string } | undefined)?.email,
    attendees: ((e.attendees as { email?: string; responseStatus?: string }[]) ?? []).slice(0, 20).map((a) => ({ email: a.email, status: a.responseStatus })),
    url: e.htmlLink,
    meet_link: e.hangoutLink,
    status: e.status,
  };
}

export default defineIntegration({
  id: "google-calendar",
  auth: AUTH,
  title: "Google Calendar",
  description: "List events, check free/busy, and schedule meetings with Meet links and invitations.",
  website: "https://developers.google.com/calendar/api",
  guidance: `
## What it does
- **read** — \`google-calendar.list_events\` lists upcoming events of a calendar (default the next 7 days of the primary calendar); \`google-calendar.free_busy\` returns the busy blocks of one or more calendars so a slot can be picked.
- **schedule** — \`google-calendar.create_event\` creates an event with optional attendees, location and a Google Meet link, and sends invitations. Send-class: the first invitation to a new address parks for the board; invites to known contacts follow the reply policy.

## Connecting (OAuth)
1. Google Cloud → APIs & Services → enable **Google Calendar API** → Credentials → OAuth client, type Web application, redirect URI = the one shown here.
2. Paste Client ID and Client Secret into the vault as \`GOOGLE_CLIENT_ID\` / \`GOOGLE_CLIENT_SECRET\`, then **Connect** with the Google account whose calendar the company should use.
3. One Google connection serves GA4, Search Console, Drive, Sheets, Calendar, Gmail and YouTube: enabling more Google integrations only adds scopes to the same Connect button (reconnect once after enabling a new one).

Calendar has no service-account path: a service account cannot see a person's calendar without Workspace domain-wide delegation.

## Enabling
\`\`\`yaml
integrations:
  - id: google-calendar
    modes: [read, schedule]
\`\`\`
Times: all-day events take \`YYYY-MM-DD\` (end is exclusive); timed events take RFC 3339 with an offset (\`2026-09-08T10:00:00+05:30\`) or a plain local time plus \`time_zone\` (\`Asia/Kolkata\`).
`,
  secrets: [
    { name: "GOOGLE_CLIENT_ID", description: "OAuth client id (shared with GA4, Search Console and the other Google integrations)", obtain: "Google Cloud → Credentials", required: false },
    { name: "GOOGLE_CLIENT_SECRET", description: "OAuth client secret", obtain: "Google Cloud → Credentials", required: false },
    { name: "GOOGLE_ACCESS_TOKEN", description: "Access token (set by Connect)", obtain: "Connect button" },
  ],
  modes: [
    { id: "read", title: "Read", description: "Events and availability", sideEffect: "read" },
    { id: "schedule", title: "Schedule", description: "Create events and send invitations", sideEffect: "send" },
  ],
  methods: [
    {
      name: "list_events",
      mode: "read",
      description: "Events between from and to (default: now to +7 days) on a calendar (default primary), earliest first.",
      input: strictSchema(
        {
          calendar_id: { type: "string", description: "primary, or a calendar's email address" },
          from: { type: "string", description: "RFC 3339 or YYYY-MM-DD" },
          to: { type: "string", description: "RFC 3339 or YYYY-MM-DD" },
          limit: { type: "integer", maximum: 50 },
        },
        [],
      ),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const from = iso(input.from, () => new Date());
        const to = iso(input.to, () => new Date((from ? Date.parse(from) : Date.now()) + 7 * 86_400_000));
        if (!from || !to) return fail("bad_input", "from/to must be RFC 3339 timestamps or YYYY-MM-DD");
        const limit = Math.min(Number(input.limit ?? 20), 50);
        const cal = String(input.calendar_id ?? "primary");
        const u = new URL(`${CAL}/calendars/${enc(cal)}/events`);
        u.searchParams.set("timeMin", from);
        u.searchParams.set("timeMax", to);
        u.searchParams.set("singleEvents", "true");
        u.searchParams.set("orderBy", "startTime");
        u.searchParams.set("maxResults", String(limit));
        u.searchParams.set("fields", "items(id,summary,description,location,start,end,attendees(email,responseStatus),organizer(email),htmlLink,hangoutLink,status)");
        const r = await gapi(token, u.toString());
        if (!r.ok) return calendarError(r);
        const events = ((r.body.items as Json[]) ?? []).slice(0, limit).map(eventOut);
        return { ok: true, calendar_id: cal, from, to, events, count: events.length };
      },
    },
    {
      name: "free_busy",
      mode: "read",
      description: "Busy blocks between from and to for one or more calendars (default primary). Gaps are free.",
      input: strictSchema(
        {
          from: { type: "string", description: "RFC 3339 or YYYY-MM-DD" },
          to: { type: "string", description: "RFC 3339 or YYYY-MM-DD" },
          calendar_ids: { type: "array", items: { type: "string" }, description: "primary and/or email addresses of colleagues' calendars" },
        },
        ["from", "to"],
      ),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const from = iso(input.from, () => new Date());
        const to = iso(input.to, () => new Date());
        if (!from || !to) return fail("bad_input", "from/to must be RFC 3339 timestamps or YYYY-MM-DD");
        const ids = (Array.isArray(input.calendar_ids) && input.calendar_ids.length ? (input.calendar_ids as unknown[]).map(String) : ["primary"]).slice(0, 20);
        const r = await gapi(token, `${CAL}/freeBusy`, "POST", { timeMin: from, timeMax: to, items: ids.map((id) => ({ id })) });
        if (!r.ok) return calendarError(r);
        const cals = (r.body.calendars as Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }>) ?? {};
        const calendars = Object.fromEntries(
          Object.entries(cals).map(([id, c]) => [id, { busy: (c.busy ?? []).slice(0, 100), errors: c.errors?.map((e) => e.reason) }]),
        );
        return { ok: true, from, to, calendars };
      },
    },
    {
      name: "create_event",
      mode: "schedule",
      description: "Create an event and send invitations to the attendees in `to`; meet: true adds a Google Meet link. First contact parks for the board.",
      input: strictSchema(
        {
          title: { type: "string" },
          start: { type: "string", description: "YYYY-MM-DD (all-day) or RFC 3339, e.g. 2026-09-08T10:00:00+05:30" },
          end: { type: "string", description: "same form as start; all-day end is exclusive" },
          description: { type: "string" },
          to: { type: "array", items: { type: "string" }, description: "attendee email addresses" },
          location: { type: "string" },
          meet: { type: "boolean", description: "add a Google Meet link" },
          calendar_id: { type: "string", description: "primary, or a calendar's email address" },
          time_zone: { type: "string", description: "IANA zone for start/end without an offset, e.g. Asia/Kolkata" },
          reason: { type: "string" },
        },
        ["title", "start", "end"],
      ),
      async handler(ctx, input) {
        const token = await accessToken(ctx);
        if (typeof token !== "string") return token;
        const title = String(input.title ?? "").trim();
        if (!title) return fail("bad_input", "title is required");
        const tz = typeof input.time_zone === "string" && input.time_zone.trim() ? input.time_zone.trim() : undefined;
        const start = when(input.start, tz);
        const end = when(input.end, tz);
        if (!start || !end) return fail("bad_input", "start/end must be YYYY-MM-DD (all-day) or RFC 3339 with an offset (2026-09-08T10:00:00+05:30), or pass time_zone");
        const attendees = (Array.isArray(input.to) ? (input.to as unknown[]).map((a) => String(a).trim().toLowerCase()).filter(Boolean) : []).slice(0, 50);
        const bad = attendees.find((a) => !EMAIL.test(a));
        if (bad) return fail("bad_input", `attendee "${bad}" is not an email address`);
        const cal = String(input.calendar_id ?? "primary");
        const event: Json = { summary: title, start, end };
        if (input.description) event.description = String(input.description);
        if (input.location) event.location = String(input.location);
        if (attendees.length) event.attendees = attendees.map((email) => ({ email }));
        if (input.meet === true) event.conferenceData = { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } };
        const r = await gapi(
          token,
          `${CAL}/calendars/${enc(cal)}/events?sendUpdates=all&conferenceDataVersion=1&fields=id,summary,start,end,attendees(email,responseStatus),organizer(email),htmlLink,hangoutLink,status`,
          "POST",
          event,
        );
        if (!r.ok) return calendarError(r);
        if (attendees.length) rememberContact(ctx.company.id, attendees);
        const out = eventOut(r.body);
        ctx.emit("artifact.created", { kind: "event", ref: String(out.id), title, url: out.url, meet_link: out.meet_link, to: attendees });
        return { ok: true, event_id: out.id, url: out.url, meet_link: out.meet_link, start: out.start, end: out.end, attendees, calendar_id: cal };
      },
    },
  ],
  async healthcheck(ctx) {
    const access = ctx.secrets.get("GOOGLE_ACCESS_TOKEN");
    if (!access) return { ok: false, detail: "not connected: Connect Google with Calendar enabled" };
    const r = await gapi(access, `${CAL}/calendars/primary?fields=id,summary,timeZone`);
    return r.ok ? { ok: true, detail: `primary calendar: ${r.body.id ?? r.body.summary ?? "ok"} (${r.body.timeZone ?? "no time zone"})` } : { ok: false, detail: errorMessage(r) };
  },
});
