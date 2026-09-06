import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth";
import { can, canCompany, COMPANY_ROLES } from "../../../../lib/rbac";
import { listCompanyAccess } from "../../../../lib/company-access";
import { INVITE_ORG_ROLES, listInvites } from "../../../../lib/invites";
import { Badge, Card, Empty, Label, PageTitle } from "../../../../components/ui";
import { setAccess, removeAccess, inviteMember, revokeInviteAction } from "./actions";

export const dynamic = "force-dynamic";

const ROLE_HELP: Record<(typeof COMPANY_ROLES)[number], string> = {
  owner: "Everything: approve, steer missions, edit company.yaml, secrets, pay, manage access.",
  reviewer: "Approve or deny, start missions and edit tasks, view everything.",
  viewer: "Look only.",
};

const ORG_ROLE_HELP: Record<(typeof INVITE_ORG_ROLES)[number], string> = {
  admin: "owns every company in the organisation, can invite and set roles",
  developer: "can create and deploy products; company roles decide the rest",
  viewer: "only what their company roles allow",
};

const label = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);

// What the owner sees in the address bar, so the copied link works on the
// sslip previews and on the real domain alike; SITE_URL is the fallback.
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return process.env.SITE_URL ?? "http://localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

function daysLeft(ts: number): string {
  const d = Math.ceil((ts - Date.now()) / 86_400_000);
  return d <= 0 ? "expires today" : d === 1 ? "expires tomorrow" : `expires in ${d} days`;
}

export default async function AccessPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ msg?: string; invite?: string; to?: string }> }) {
  const [{ slug }, { msg, invite, to }] = await Promise.all([params, searchParams]);
  const session = await getSession();
  if (!session) redirect(`/login?next=/c/${slug}/access`);

  if (!canCompany(session, slug, "company:access:manage")) {
    return (
      <main>
        <PageTitle eyebrow="Who can do what" title="Access" />
        <Card className="max-w-lg">
          <p className="font-medium">Only company owners manage access.</p>
          <p className="mt-1 text-sm text-[var(--muted)]">Ask the board if someone needs a role on this company.</p>
        </Card>
      </main>
    );
  }

  const rows = listCompanyAccess(session.orgId, slug);
  const withAccess = rows.filter((r) => r.company_role);
  const without = rows.filter((r) => !r.company_role);
  const canInvite = can(session, "member:invite");
  const invites = canInvite ? listInvites(session.orgId) : [];
  const inviteLink = invite ? `${await requestOrigin()}/register?invite=${encodeURIComponent(invite)}` : null;

  return (
    <main>
      <PageTitle eyebrow="Who can do what" title="Access" />
      {msg ? <p className="mb-4 rounded-[var(--r-1)] bg-[var(--surface-2)] px-3 py-2 text-sm">{msg}</p> : null}
      {inviteLink ? (
        <Card className="mb-5">
          <Label className="mb-1">Invite link for {to ?? "the invitee"}</Label>
          <p className="text-sm">Copy this and send it yourself; the app does not email it. It works once, for that email, for seven days.</p>
          <input readOnly value={inviteLink} className="field mt-3 font-mono text-xs" aria-label="Invite link" />
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card>
            <Label className="mb-3">People on this company</Label>
            {withAccess.length === 0 ? <Empty>Nobody yet besides the organisation owners.</Empty> : null}
            <ul className="divide-y divide-[var(--hairline)]">
              {withAccess.map((r) => (
                <li key={r.user_id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.name ?? r.email}</p>
                    <p className="truncate text-xs text-[var(--muted)]">{r.email} · organisation {r.org_role}</p>
                  </div>
                  {r.implicit ? (
                    <Badge tone="brass">Owner · via organisation role</Badge>
                  ) : (
                    <>
                      <form action={setAccess} className="flex items-center gap-2">
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="email" value={r.email} />
                        <select name="role" defaultValue={r.company_role ?? "viewer"} className="field w-auto py-1.5 text-sm" aria-label={`Role for ${r.email}`}>
                          {COMPANY_ROLES.map((role) => (
                            <option key={role} value={role}>{label(role)}</option>
                          ))}
                        </select>
                        <button className="btn btn-glass py-1.5" type="submit">Update</button>
                      </form>
                      <form action={removeAccess}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="user_id" value={r.user_id} />
                        <button className="btn btn-danger py-1.5" type="submit">Remove</button>
                      </form>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          {canInvite ? (
            <Card>
              <Label className="mb-3">Pending invites</Label>
              {invites.length === 0 ? <Empty>No open invites in {session.orgName}.</Empty> : null}
              <ul className="divide-y divide-[var(--hairline)]">
                {invites.map((i) => {
                  const here = i.grants.find((g) => g.slug === slug);
                  const elsewhere = i.grants.filter((g) => g.slug !== slug);
                  return (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{i.email}</p>
                        <p className="truncate text-xs text-[var(--muted)]">
                          organisation {i.orgRole}
                          {here ? ` · ${here.role} here` : ""}
                          {elsewhere.length ? ` · ${elsewhere.map((g) => `${g.role} on ${g.slug}`).join(", ")}` : ""}
                          {` · invited by ${i.invitedBy} · ${daysLeft(i.expiresAt)}`}
                        </p>
                      </div>
                      <form action={revokeInviteAction}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="invite_id" value={i.id} />
                        <button className="btn btn-danger py-1.5" type="submit">Revoke</button>
                      </form>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-[var(--muted)]">A link is shown once, when it is created; revoke and invite again if it was lost.</p>
            </Card>
          ) : null}

          <Card>
            <Label className="mb-3">Members without access</Label>
            {without.length === 0 ? <Empty>Every member of {session.orgName} has a role here.</Empty> : null}
            <ul className="divide-y divide-[var(--hairline)]">
              {without.map((r) => (
                <li key={r.user_id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{r.name ?? r.email}</p>
                    <p className="truncate text-xs text-[var(--muted)]">{r.email} · organisation {r.org_role}</p>
                  </div>
                  <form action={setAccess} className="flex items-center gap-2">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="email" value={r.email} />
                    <select name="role" defaultValue="viewer" className="field w-auto py-1.5 text-sm" aria-label={`Role for ${r.email}`}>
                      {COMPANY_ROLES.map((role) => (
                        <option key={role} value={role}>{label(role)}</option>
                      ))}
                    </select>
                    <button className="btn btn-primary py-1.5" type="submit">Grant</button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          {canInvite ? (
            <Card>
              <Label className="mb-2">Invite someone</Label>
              <form action={inviteMember} className="space-y-2">
                <input type="hidden" name="slug" value={slug} />
                <input name="email" type="email" className="field" placeholder="surabhi@example.com" required />
                <label className="block text-xs text-[var(--muted)]">
                  Organisation role
                  <select name="org_role" defaultValue="viewer" className="field mt-1">
                    {INVITE_ORG_ROLES.map((role) => (
                      <option key={role} value={role}>{label(role)}: {ORG_ROLE_HELP[role]}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-[var(--muted)]">
                  Role on this company
                  <select name="company_role" defaultValue="reviewer" className="field mt-1">
                    <option value="reviewer">Reviewer: {ROLE_HELP.reviewer}</option>
                    <option value="viewer">Viewer: {ROLE_HELP.viewer}</option>
                  </select>
                </label>
                <button className="btn btn-primary w-full justify-center" type="submit">Create invite link</button>
              </form>
              <p className="mt-2 text-xs text-[var(--muted)]">For people who are not in {session.orgName} yet. You get a link to send; they register or sign in through it and land here with the roles above.</p>
            </Card>
          ) : null}
          <Card>
            <Label className="mb-2">Grant by email</Label>
            <form action={setAccess} className="space-y-2">
              <input type="hidden" name="slug" value={slug} />
              <input name="email" type="email" className="field" placeholder="surabhi@example.com" required />
              <select name="role" defaultValue="reviewer" className="field">
                {COMPANY_ROLES.map((role) => (
                  <option key={role} value={role}>{label(role)}</option>
                ))}
              </select>
              <button className="btn btn-primary w-full justify-center" type="submit">Grant access</button>
            </form>
            <p className="mt-2 text-xs text-[var(--muted)]">For existing members of {session.orgName}. Not a member yet? Use the invite above instead.</p>
          </Card>
          <Card>
            <Label className="mb-2">Roles</Label>
            <ul className="space-y-2 text-sm">
              {COMPANY_ROLES.map((role) => (
                <li key={role} className="raised p-2.5">
                  <p className="font-medium">{label(role)}</p>
                  <p className="mt-0.5 text-xs text-[var(--ink-2)]">{ROLE_HELP[role]}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-[var(--muted)]">Organisation owners and admins own every company without a row here. Every grant and removal is an audit event.</p>
          </Card>
        </div>
      </div>
    </main>
  );
}
