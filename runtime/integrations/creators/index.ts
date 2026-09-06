// Creator programme as an integration: agents register creators, record
// attributed events, read stats, and request payouts (which become
// board-approved expenses). No credentials; data lives in the control plane.

import { defineIntegration, strictSchema, fail } from "../../src/integrations/registry.js";
import * as cr from "../../src/creators.js";

export default defineIntegration({
  id: "creators",
  title: "Creator programme",
  description: "Creators on commission: roster, referral codes, attributed signups and revenue, payouts through ERP.",
  guidance: `
## What it does
- **manage** — \`creators.add\` registers a creator (age confirmed, 18+) and issues a referral code; \`creators.update\` changes status or notes; \`creators.record\` logs a video, a signup or attributed revenue; \`creators.list\` and \`creators.stats\` read the roster and the numbers.
- **payout** — \`creators.payout\` files the commission owed as an expense the board approves and pays from a cash account. Agents never pay.

The offer itself (commission %, one video a day, no paid ads) is policy: it lives in the kit and in role prompts, and \`creators.add\` records the commission percentage the board set. Playbook: docs/company/playbooks/ugc-creators.md.
`,
  secrets: [],
  modes: [
    { id: "manage", title: "Manage", description: "Roster, codes, events, stats", sideEffect: "write" },
    { id: "payout", title: "Payout", description: "Request commission payouts", sideEffect: "spend" },
  ],
  methods: [
    {
      name: "add", mode: "manage",
      description: "Register a creator who accepted the offer. Age must be confirmed (18+). Returns their referral code.",
      input: strictSchema({ name: { type: "string" }, handle: { type: "string" }, platform: { type: "string", enum: ["tiktok", "instagram", "youtube", "linkedin", "x"] }, email: { type: "string" }, age_confirmed: { type: "boolean" }, commission_pct: { type: "integer", minimum: 1, maximum: 50 }, notes: { type: "string" } }, ["name", "age_confirmed"]),
      async handler(ctx, input) {
        try {
          const c = cr.addCreator(ctx.company.id, { name: String(input.name), handle: input.handle as string, platform: input.platform as string, email: input.email as string, commission_pct: input.commission_pct as number, age_confirmed: Boolean(input.age_confirmed), notes: input.notes as string });
          return { ok: true, creator_id: c.id, code: c.code, commission_pct: c.commission_pct };
        } catch (e) {
          return fail("rejected", (e as Error).message);
        }
      },
    },
    {
      name: "update", mode: "manage",
      description: "Change a creator's status (active | inactive | churned) or notes.",
      input: strictSchema({ creator_id: { type: "string" }, status: { type: "string", enum: ["active", "inactive", "churned"] }, notes: { type: "string" } }, ["creator_id"]),
      async handler(ctx, input) {
        cr.updateCreator(ctx.company.id, String(input.creator_id), { status: input.status as never, notes: input.notes as string });
        return { ok: true };
      },
    },
    {
      name: "record", mode: "manage",
      description: "Record a video (with views), a signup, or attributed revenue (minor units) for a creator by code.",
      input: strictSchema({ code: { type: "string" }, kind: { type: "string", enum: ["video", "signup", "revenue"] }, views: { type: "integer" }, amount_minor: { type: "integer" }, ref: { type: "string" }, memo: { type: "string" } }, ["code", "kind"]),
      async handler(ctx, input) {
        try {
          const e = cr.recordEvent(ctx.company.id, { code: String(input.code) }, { kind: input.kind as never, views: input.views as number, amount_minor: input.amount_minor as number, ref: input.ref as string, memo: input.memo as string });
          return { ok: true, event_id: e.id };
        } catch (err) {
          return fail("rejected", (err as Error).message);
        }
      },
    },
    {
      name: "list", mode: "manage", sideEffect: "read",
      description: "The roster with codes and status.",
      input: strictSchema({ status: { type: "string", enum: ["active", "inactive", "churned"] } }, []),
      async handler(ctx, input) {
        return { ok: true, creators: cr.creators(ctx.company.id, input.status as string).map((c) => ({ id: c.id, name: c.name, handle: c.handle, platform: c.platform, code: c.code, status: c.status, last_video_at: c.last_video_at })) };
      },
    },
    {
      name: "stats", mode: "manage", sideEffect: "read",
      description: "Per-creator videos, views, signups, revenue, commission owed; plus programme totals. Optional period YYYY-MM.",
      input: strictSchema({ period: { type: "string" } }, []),
      async handler(ctx, input) {
        return { ok: true, totals: cr.summary(ctx.company.id), creators: cr.stats(ctx.company.id, input.period as string) };
      },
    },
    {
      name: "payout", mode: "payout",
      description: "Request payout of a creator's commission owed. Files an expense for the board; spend-gated.",
      input: strictSchema({ creator_id: { type: "string" }, reason: { type: "string" } }),
      async handler(ctx, input) {
        try {
          const r = cr.requestPayout(ctx.company.id, String(input.creator_id), ctx.agent.name);
          return { ok: true, ...r, note: "filed as an expense; the board approves and pays from cash" };
        } catch (e) {
          return fail("rejected", (e as Error).message);
        }
      },
    },
  ],
});
