import type { DashboardModule } from "../types";

const releases = [
  {
    product: "Nish Alpha Hive",
    id: "stage-a",
    gates: "8/8",
    when: "today",
  },
  {
    product: "Bakery Demo",
    id: "20260820-052447",
    gates: "8/8",
    when: "today",
  },
  {
    product: "Golden Path Two",
    id: "20260820-040748",
    gates: "7/7",
    when: "today",
  },
];

function Panel() {
  return (
    <ul className="space-y-2.5 text-sm">
      {releases.map((r) => (
        <li
          key={r.product + r.id}
          className="flex items-center justify-between border-t border-[var(--line)] pt-2.5 first:border-t-0 first:pt-0"
        >
          <div>
            <p>{r.product}</p>
            <p className="font-mono text-xs text-[var(--muted)]">{r.id}</p>
          </div>
          <div className="text-right">
            <p className="text-[var(--good)]">gates {r.gates}</p>
            <p className="text-xs text-[var(--muted)]">{r.when}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const mod: DashboardModule = {
  id: "deployments",
  version: "0.1.0",
  title: "Deployments",
  description: "Release history with the gate results that let each one ship.",
  Panel,
};

export default mod;
