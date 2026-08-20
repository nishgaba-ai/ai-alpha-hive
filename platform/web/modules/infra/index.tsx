import type { DashboardModule } from "../types";

const connections = [
  { name: "alpha-hive-core", kind: "droplet · BLR1", status: "healthy" },
  { name: "Vercel (prodigal-ai)", kind: "vercel", status: "connected" },
  { name: "GitHub (nishgaba-ai)", kind: "git remote", status: "connected" },
];

function Panel() {
  return (
    <ul className="space-y-2.5 text-sm">
      {connections.map((c) => (
        <li
          key={c.name}
          className="flex items-center justify-between border-t border-[var(--line)] pt-2.5 first:border-t-0 first:pt-0"
        >
          <div>
            <p>{c.name}</p>
            <p className="font-mono text-xs text-[var(--muted)]">{c.kind}</p>
          </div>
          <span className="text-[var(--good)]">● {c.status}</span>
        </li>
      ))}
    </ul>
  );
}

const mod: DashboardModule = {
  id: "infra",
  version: "0.1.0",
  title: "Infrastructure",
  description: "Connected launch targets — yours, ours, or local.",
  Panel,
};

export default mod;
