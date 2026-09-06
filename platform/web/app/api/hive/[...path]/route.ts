// Session-guarded proxy to the company runtime API. Client components use
// this so the worker token and URL never reach the browser. Streams SSE.

import { NextRequest } from "next/server";
import { getSession, type Session } from "../../../../lib/auth";
import { canCompany, type CompanyPermission } from "../../../../lib/rbac";
import { HIVE_URL } from "../../../../lib/hive";

export const dynamic = "force-dynamic";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Company-scoped paths carry the same per-company permissions as the
// server actions (lib/rbac.ts COMPANY_MATRIX). Reads need company:view;
// writes map by resource, unknown writes fall closed to company:config.
function companyPermission(method: string, rest: string[]): CompanyPermission {
  if (method === "GET" || method === "HEAD") return "company:view";
  switch (rest[0]) {
    case "approvals":
      return "company:approve";
    case "missions":
    case "tasks":
    case "creators":
      return "company:mission";
    case "secrets":
    case "integrations":
      return "company:secrets";
    case "erp":
      return "company:erp:pay";
    case "ask":
    case "voice":
      return "company:view"; // talking to the company is reading it
    default:
      return "company:config"; // yaml, pause/resume, everything else
  }
}

function allowed(session: Session, method: string, path: string[]): boolean {
  if (path[0] !== "companies" || !path[1]) return true; // group-level: session is enough
  return canCompany(session, path[1], companyPermission(method, path.slice(2)));
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await getSession();
  if (!session) return json(401, { error: "unauthorized" });
  const { path } = await ctx.params;
  if (!allowed(session, req.method, path)) return json(403, { error: "You do not have access to do that on this company." });
  const url = `${HIVE_URL}/api/${path.join("/")}${req.nextUrl.search}`;
  const headers: Record<string, string> = {};
  const ct = req.headers.get("content-type");
  if (ct) headers["Content-Type"] = ct;
  if (process.env.HIVE_API_TOKEN) headers.Authorization = `Bearer ${process.env.HIVE_API_TOKEN}`;
  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    // @ts-expect-error node fetch needs duplex for streamed bodies
    duplex: "half",
    cache: "no-store",
  });
  const out = new Headers();
  for (const k of ["content-type", "cache-control", "content-disposition"]) {
    const v = upstream.headers.get(k);
    if (v) out.set(k, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
