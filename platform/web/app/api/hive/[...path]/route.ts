// Session-guarded proxy to the company runtime API. Client components use
// this so the worker token and URL never reach the browser. Streams SSE.

import { NextRequest } from "next/server";
import { getSession } from "../../../../lib/auth";
import { HIVE_URL } from "../../../../lib/hive";

export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await getSession();
  if (!session) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  const { path } = await ctx.params;
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
