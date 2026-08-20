import type { DashboardModule } from "../types";

// Demo data until systems/rbac + the products API land (Stage B) — then this
// module swaps its data source and nothing else on the dashboard changes.
const products = [
  {
    name: "Bakery Demo",
    target: "own droplet",
    status: "live",
    url: "http://bakery-demo.168.144.27.122.sslip.io",
  },
  {
    name: "Nish Alpha Hive",
    target: "own droplet",
    status: "live",
    url: "/",
  },
  {
    name: "Golden Path Two",
    target: "vercel",
    status: "preview",
    url: null,
  },
];

function Panel() {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left font-mono text-[11px] uppercase tracking-wider text-[var(--muted)]">
          <th className="pb-2">Product</th>
          <th className="pb-2">Target</th>
          <th className="pb-2">Status</th>
        </tr>
      </thead>
      <tbody>
        {products.map((p) => (
          <tr key={p.name} className="border-t border-[var(--line)]">
            <td className="py-2.5">
              {p.url ? (
                <a href={p.url} className="hover:text-[var(--brand)]">
                  {p.name}
                </a>
              ) : (
                p.name
              )}
            </td>
            <td className="py-2.5 text-[var(--muted)]">{p.target}</td>
            <td className="py-2.5">
              <span
                className={
                  p.status === "live"
                    ? "text-[var(--good)]"
                    : "text-[var(--brand)]"
                }
              >
                ● {p.status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const mod: DashboardModule = {
  id: "products",
  version: "0.1.0",
  title: "Products",
  description: "Every product you've launched, across all targets.",
  Panel,
};

export default mod;
