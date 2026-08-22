import type { DashboardModule, ModuleContext } from "../types";
import { getDb } from "../../lib/db";
import { can } from "../../lib/rbac";
import { createProduct, deleteProduct } from "../../app/dashboard/products/actions";

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  target: string;
  status: string;
  url: string | null;
  created_at: number;
};

const TARGET_LABEL: Record<string, string> = {
  managed: "with us",
  "own-infra": "own infra",
  local: "local",
};

async function Panel({ session }: ModuleContext) {
  const rows = getDb()
    .prepare("SELECT id, name, slug, target, status, url, created_at FROM products WHERE org_id = ? ORDER BY created_at DESC")
    .all(session.orgId) as ProductRow[];
  const mayCreate = can(session, "product:create");
  const mayDelete = can(session, "product:delete");

  return (
    <div className="text-sm">
      {rows.length === 0 ? (
        <p className="text-[var(--muted)]">No products yet — create your first one below.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left font-mono text-[11px] uppercase tracking-wider text-[var(--muted)]">
              <th className="pb-2">Product</th>
              <th className="pb-2">Target</th>
              <th className="pb-2">Status</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-[var(--line)]">
                <td className="py-2.5">
                  {p.url ? <a href={p.url} className="hover:text-[var(--brand)]">{p.name}</a> : p.name}
                  <span className="ml-2 font-mono text-xs text-[var(--muted)]">{p.slug}</span>
                </td>
                <td className="py-2.5 text-[var(--muted)]">{TARGET_LABEL[p.target] ?? p.target}</td>
                <td className="py-2.5">
                  <span className={p.status === "live" ? "text-[var(--good)]" : "text-[var(--brand)]"}>● {p.status}</span>
                </td>
                <td className="py-2.5 text-right">
                  {mayDelete ? (
                    <form action={deleteProduct}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="text-xs text-[var(--muted)] hover:text-[#e07a6a]">remove</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {mayCreate ? (
        <form action={createProduct} className="mt-5 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
          <input
            name="name"
            required
            maxLength={80}
            placeholder="New product name"
            className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--ground)] px-3 py-2 outline-none focus:border-[var(--brand-dim)]"
          />
          <select name="target" className="rounded-md border border-[var(--line)] bg-[var(--ground)] px-3 py-2">
            <option value="managed">launch with us</option>
            <option value="own-infra">own infra</option>
            <option value="local">local</option>
          </select>
          <button type="submit" className="rounded-md bg-[var(--brand)] px-4 py-2 font-medium text-[#141005] hover:bg-[#f0bd52]">
            Create
          </button>
        </form>
      ) : (
        <p className="mt-4 text-xs text-[var(--muted)]">Your role ({session.role}) can view products but not create them.</p>
      )}
    </div>
  );
}

const mod: DashboardModule = {
  id: "products",
  version: "0.2.0",
  title: "Products",
  description: "Every product in this workspace, across all launch targets.",
  Panel,
};

export default mod;
