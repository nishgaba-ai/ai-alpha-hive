// Copies docs/company/**/*.md into content/docs so the product can render
// them at /docs (locally and on Vercel, where only platform/web is built).
import fs from "node:fs";
import path from "node:path";

const src = path.resolve(process.cwd(), "..", "..", "docs", "company");
const dst = path.resolve(process.cwd(), "content", "docs");
if (!fs.existsSync(src)) {
  console.log("[sync-docs] no docs/company next to platform/web; keeping existing content/docs");
  process.exit(0);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
function walk(dir, rel = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, path.join(rel, e.name));
    else if (e.name.endsWith(".md")) {
      fs.mkdirSync(path.join(dst, rel), { recursive: true });
      fs.copyFileSync(p, path.join(dst, rel, e.name));
    }
  }
}
walk(src);
console.log("[sync-docs] copied docs/company → content/docs");
