import { hiveOr } from "../../../../lib/hive";
import { Card, Label, Badge, sideEffectTone, PageTitle } from "../../../../components/ui";
import { storeSecret, enableIntegration, checkIntegration, connectIntegration } from "./actions";

export const dynamic = "force-dynamic";

type Integration = {
  id: string; title: string; description: string; website?: string; guidance: string;
  secrets: { name: string; description: string; obtain: string; required?: boolean; modes?: string[] }[];
  auth: { kind: "api_key"; guide?: string } | { kind: "none" } | { kind: "oauth2"; prefix: string; scopes: string[]; guide: string };
  oauth: { connected: boolean; expires_at: number | null; can_refresh: boolean; has_client: boolean; redirect_uri: string } | null;
  modes: { id: string; title: string; description: string; sideEffect: string }[];
  methods: { name: string; mode: string; description: string; sideEffect?: string }[];
  enabled: boolean; enabled_modes: string[]; missing_secrets: string[]; secrets_present: string[];
};

function Guidance({ md }: { md: string }) {
  // Minimal markdown, line-aware: headings, bullet/numbered lists, code fences, paragraphs; inline code and bold.
  const inline = (t: string) => t.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((p, j) => p.startsWith("`") ? <code key={j} className="font-mono text-[12px] text-[var(--accent)]">{p.slice(1, -1)}</code> : p.startsWith("**") ? <strong key={j} className="text-[var(--ink)]">{p.slice(2, -2)}</strong> : p);
  const out: React.ReactNode[] = [];
  const lines = md.trim().split("\n");
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(<pre key={out.length} className="overflow-x-auto rounded-[var(--r-1)] bg-[var(--surface-0)] p-3 font-mono text-[11px]">{buf.join("\n")}</pre>);
    } else if (l.startsWith("## ")) {
      out.push(<p key={out.length} className="label mt-3">{l.slice(3)}</p>);
      i++;
    } else if (/^\s*(-|\d+\.)\s/.test(l)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(l);
      while (i < lines.length && /^\s*(-|\d+\.)\s/.test(lines[i])) items.push(lines[i++].replace(/^\s*(-|\d+\.)\s/, ""));
      out.push(ordered ? <ol key={out.length} className="list-inside list-decimal space-y-1">{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol> : <ul key={out.length} className="list-inside list-disc space-y-1">{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
    } else if (l.trim() === "") {
      i++;
    } else {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("## ") && !/^\s*(-|\d+\.)\s/.test(lines[i]) && !lines[i].startsWith("```")) buf.push(lines[i++]);
      out.push(<p key={out.length}>{inline(buf.join(" "))}</p>);
    }
  }
  return <div className="space-y-2 text-sm text-[var(--ink-2)]">{out}</div>;
}

function SecretForm({ slug, id, s, present }: { slug: string; id: string; s: Integration["secrets"][number]; present: boolean }) {
  return (
    <form action={storeSecret} className="mb-3">
      <input type="hidden" name="slug" value={slug} /><input type="hidden" name="name" value={s.name} /><input type="hidden" name="id" value={id} />
      <div className="flex items-center justify-between"><code className="font-mono text-xs">{s.name}</code>{present ? <Badge tone="live">stored</Badge> : s.required === false ? <Badge>optional</Badge> : <Badge tone="parked">missing</Badge>}</div>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">{s.description} · {s.obtain}</p>
      <div className="mt-1 flex gap-1"><input name="value" type="password" className="field py-1.5 text-sm" placeholder={present ? "replace value" : "paste value"} autoComplete="off" required /><button className="btn btn-glass py-1.5" type="submit">Save</button></div>
    </form>
  );
}

export default async function IntegrationsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ open?: string; msg?: string }> }) {
  const { slug } = await params;
  const { open, msg } = await searchParams;
  const list = await hiveOr<Integration[]>(`/api/companies/${slug}/integrations`, []);
  const mcp = await hiveOr<{ name: string; transport: string; side_effect: string; connected: boolean; error: string | null; tools: { name: string; side_effect: string }[] }[]>(`/api/companies/${slug}/mcp`, []);
  return (
    <main>
      <PageTitle eyebrow="The library" title="Integrations" />
      {msg ? <p className="mb-4 rounded-[var(--r-1)] bg-[var(--surface-2)] p-3 text-sm">{msg}</p> : null}
      <p className="mb-5 max-w-3xl text-sm text-[var(--ink-2)]">Each integration is a plugin with modes (permission bundles) and a declared way to authenticate: paste a key, or connect with OAuth and let the runtime keep the token fresh. Keys and tokens are encrypted in the vault and never reach a model.</p>
      <div className="space-y-4">
        {list.map((i) => {
          const isOpen = open === i.id;
          const oauth = i.auth.kind === "oauth2" ? i.auth : null;
          const clientSecrets = oauth ? i.secrets.filter((s) => s.name === `${oauth.prefix}_CLIENT_ID` || s.name === `${oauth.prefix}_CLIENT_SECRET`) : [];
          const otherSecrets = i.secrets.filter((s) => !clientSecrets.includes(s));
          return (
            <Card key={i.id} className={isOpen ? "ring-1 ring-[var(--accent-2)]" : ""}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-xl">{i.title}</h2>
                    {i.enabled ? <Badge tone="live">enabled · {i.enabled_modes.join(", ")}</Badge> : <Badge>off</Badge>}
                    {i.auth.kind === "oauth2" ? (i.oauth?.connected ? <Badge tone="live">connected{i.oauth.can_refresh ? " · auto-refresh" : ""}</Badge> : <Badge tone="brass">OAuth</Badge>) : i.auth.kind === "api_key" ? <Badge>API key</Badge> : <Badge>no credentials</Badge>}
                    {i.enabled && i.missing_secrets.length ? <Badge tone="parked">missing {i.missing_secrets.join(", ")}</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-[var(--ink-2)]">{i.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {i.website ? <a href={i.website} target="_blank" rel="noreferrer" className="btn btn-ghost">Docs ↗</a> : null}
                  <a href={`/c/${slug}/integrations?open=${isOpen ? "" : i.id}`} className="btn btn-glass">{isOpen ? "Close" : "Configure"}</a>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {i.modes.map((m) => (
                  <span key={m.id} className="raised flex items-center gap-2 px-2.5 py-1 text-xs"><span className="font-medium">{m.id}</span><Badge tone={sideEffectTone(m.sideEffect)}>{m.sideEffect}</Badge><span className="text-[var(--muted)]">{m.description}</span></span>
                ))}
              </div>
              {isOpen ? (
                <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_380px]">
                  <div>
                    <Guidance md={i.guidance} />
                    <Label className="mb-2 mt-4">Methods</Label>
                    <ul className="space-y-1 text-sm">
                      {i.methods.map((m) => <li key={m.name} className="flex items-center gap-2"><code className="font-mono text-xs text-[var(--accent)]">{m.name}</code><Badge tone={sideEffectTone(m.sideEffect ?? "read")}>{m.sideEffect}</Badge><span className="text-[var(--ink-2)]">{m.description}</span></li>)}
                    </ul>
                  </div>
                  <div className="space-y-4">
                    {oauth ? (
                      <div className="raised p-4">
                        <div className="flex items-center justify-between"><Label>Connect with OAuth</Label>{i.oauth?.connected ? <Badge tone="live">connected</Badge> : <Badge tone="parked">not connected</Badge>}</div>
                        <ol className="mt-2 list-inside list-decimal space-y-1.5 text-xs text-[var(--ink-2)]">
                          <li>Create the app: <span className="text-[var(--ink)]">{oauth.guide}</span></li>
                          <li>Register this redirect URI with the provider:<br /><code className="mt-1 block select-all rounded bg-[var(--surface-0)] px-2 py-1 font-mono text-[11px] text-[var(--accent)]">{i.oauth?.redirect_uri}</code></li>
                          <li>Paste the client id and secret below, then Connect.</li>
                        </ol>
                        <div className="mt-3">{clientSecrets.map((s) => <SecretForm key={s.name} slug={slug} id={i.id} s={s} present={i.secrets_present.includes(s.name)} />)}</div>
                        <form action={connectIntegration}>
                          <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={i.id} />
                          <button className="btn btn-primary w-full justify-center" type="submit" disabled={!i.oauth?.has_client} title={i.oauth?.has_client ? "" : "store the client id and secret first"}>{i.oauth?.connected ? `Reconnect ${i.title}` : `Connect ${i.title}`}</button>
                        </form>
                        <p className="mt-2 text-[11px] text-[var(--muted)]">Scopes: {oauth.scopes.join(" ")}{i.oauth?.expires_at ? ` · token valid until ${new Date(i.oauth.expires_at).toLocaleString("en-IN")}` : ""}</p>
                      </div>
                    ) : null}
                    <div className="raised p-4">
                      <Label className="mb-2">{oauth ? "Other secrets, or paste a token instead" : "Secrets"}</Label>
                      {i.auth.kind === "api_key" && i.auth.guide ? <p className="mb-2 text-[11px] text-[var(--muted)]">{i.auth.guide}</p> : null}
                      {otherSecrets.length === 0 ? <p className="text-xs text-[var(--muted)]">None needed.</p> : null}
                      {otherSecrets.map((s) => <SecretForm key={s.name} slug={slug} id={i.id} s={s} present={i.secrets_present.includes(s.name)} />)}
                    </div>
                    <div className="raised p-4">
                      <Label className="mb-2">Enable for agents</Label>
                      <form action={enableIntegration} className="space-y-2">
                        <input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={i.id} />
                        {i.modes.map((m) => <label key={m.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="modes" value={m.id} defaultChecked={i.enabled ? i.enabled_modes.includes(m.id) : true} />{m.id} <span className="text-xs text-[var(--muted)]">({m.sideEffect})</span></label>)}
                        <button className="btn btn-glass w-full justify-center" type="submit">{i.enabled ? "Update modes" : "Enable"}</button>
                        <p className="text-[11px] text-[var(--muted)]">Writes the entry into company.yaml and reloads the worker. Then grant tools to roles in Settings, e.g. <code className="font-mono">{i.id}.*</code></p>
                      </form>
                    </div>
                    {i.auth.kind !== "none" ? <form action={checkIntegration}><input type="hidden" name="slug" value={slug} /><input type="hidden" name="id" value={i.id} /><button className="btn btn-ghost w-full justify-center" type="submit">Run healthcheck</button></form> : null}
                  </div>
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>MCP servers</Label>
          <span className="text-xs text-[var(--muted)]">any MCP server becomes an integration; every tool still passes the gate</span>
        </div>
        {mcp.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-2)]">None attached. In Settings add, for example:</p>
        ) : null}
        {mcp.length === 0 ? (
          <pre className="mt-2 overflow-x-auto rounded-[var(--r-1)] bg-[var(--surface-0)] p-3 font-mono text-xs text-[var(--ink-2)]">{`integrations:
  - mcp: "npx -y @modelcontextprotocol/server-filesystem ./workspace"
    name: files
    side_effect: write
    overrides: { read_file: read, list_directory: read }
  - mcp: "https://mcp.example.com/mcp"
    name: crm
    side_effect: send
    headers: { Authorization: "Bearer vault:CRM_TOKEN" }`}</pre>
        ) : null}
        <div className="mt-3 space-y-2">
          {mcp.map((m) => (
            <div key={m.name} className="rounded-[var(--r-2)] border border-[var(--hairline)] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.name}</span>
                <Badge tone="muted">{m.transport}</Badge>
                <Badge tone={sideEffectTone(m.side_effect)}>{m.side_effect}</Badge>
                <Badge tone={m.connected ? "live" : "failed"}>{m.connected ? `${m.tools.length} tools` : "not connected"}</Badge>
                {m.error ? <span className="text-xs text-[var(--failed)]">{m.error}</span> : null}
              </div>
              {m.tools.length ? <p className="mt-1 text-xs text-[var(--muted)]">{m.tools.map((t) => `${t.name} (${t.side_effect})`).join(" · ")}</p> : null}
              <p className="mt-1 text-xs text-[var(--muted)]">Grant to roles as <code className="font-mono">{m.name}.*</code> or <code className="font-mono">{m.name}.&lt;tool&gt;</code>.</p>
            </div>
          ))}
        </div>
      </Card>
      <Card className="mt-6">
        <Label className="mb-1">Build your own</Label>
        <p className="text-sm text-[var(--ink-2)]">Add a folder under <code className="font-mono text-[var(--accent)]">runtime/integrations/&lt;id&gt;/</code> exporting <code className="font-mono">defineIntegration</code> with modes, methods, secrets and an <code className="font-mono">auth</code> declaration (API key or OAuth 2.0), list it in the index, and it appears here with the right form. Guide: <code className="font-mono">docs/company/integrations.md</code>.</p>
      </Card>
    </main>
  );
}
