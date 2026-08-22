// The "standard" login template preset — shared auth UI primitives
// (docs/specs/login-rbac.md §2). Custom/advanced presets restyle these
// through tokens and slots; the form contracts stay identical.

export function AuthShell({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex max-w-md flex-col px-6 py-20">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--brand)]">
        rbac · standard preset
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 mb-8 text-sm text-[var(--muted)]">{lead}</p>
      {children}
    </main>
  );
}

export function Field({
  label,
  name,
  type,
  autoComplete,
  minLength,
}: {
  label: string;
  name: string;
  type: string;
  autoComplete?: string;
  minLength?: number;
}) {
  return (
    <label className="block text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <input
        type={type}
        name={name}
        required
        autoComplete={autoComplete}
        minLength={minLength}
        className="mt-1.5 w-full rounded-md border border-[var(--line)] bg-[var(--panel)] px-3.5 py-2.5 outline-none focus:border-[var(--brand-dim)]"
      />
    </label>
  );
}

export function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "error";
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={
        "mb-4 rounded-md border px-3.5 py-2.5 text-sm " +
        (tone === "error"
          ? "border-[#5a2a22] text-[#e07a6a]"
          : "border-[var(--line)] bg-[var(--panel)] text-[var(--ink)]")
      }
    >
      {children}
    </p>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="submit"
      className="w-full rounded-md bg-[var(--brand)] px-4 py-2.5 font-medium text-[#141005] hover:bg-[#f0bd52]"
    >
      {children}
    </button>
  );
}
