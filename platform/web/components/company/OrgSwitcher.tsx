"use client";

import { useRef } from "react";

type Item = { orgId: string; orgName: string; role: string };

// Only rendered when the user belongs to more than one organisation. A
// plain form posting the server action, so it works without JS too; the
// change handler just saves the click on "Switch".
export function OrgSwitcher({ orgs, currentOrgId, action }: { orgs: Item[]; currentOrgId: string; action: (form: FormData) => Promise<void> }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} action={action} className="flex shrink-0 items-center gap-1">
      <select
        name="org_id"
        aria-label="Organisation"
        title="Organisation"
        className="field w-auto max-w-[180px] py-1.5 text-[13px]"
        defaultValue={currentOrgId}
        onChange={() => ref.current?.requestSubmit()}
      >
        {orgs.map((o) => (
          <option key={o.orgId} value={o.orgId}>{o.orgName} · {o.role}</option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="btn btn-ghost px-2.5 py-1.5 text-[13px]">Switch</button>
      </noscript>
    </form>
  );
}
