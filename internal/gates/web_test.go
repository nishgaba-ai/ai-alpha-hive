package gates

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, dir, rel, content string) {
	t.Helper()
	path := filepath.Join(dir, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDepsGate(t *testing.T) {
	dir := t.TempDir()
	// non-web project: skipped
	res, _ := (&DepsGate{}).Check(context.Background(), dir)
	if !res.Skipped {
		t.Fatal("expected skip without package.json")
	}
	// web project without node_modules: fail
	write(t, dir, "package.json", "{}")
	res, _ = (&DepsGate{}).Check(context.Background(), dir)
	if res.Passed {
		t.Fatal("expected failure without node_modules")
	}
	// with node_modules: pass
	os.MkdirAll(filepath.Join(dir, "node_modules"), 0o755)
	res, _ = (&DepsGate{}).Check(context.Background(), dir)
	if !res.Passed {
		t.Fatal("expected pass with node_modules")
	}
}

func TestLinksGate(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "app/page.tsx", `<a href="/about">ok</a><a href="/missing">broken</a><a href="/logo.svg">file</a>`)
	write(t, dir, "app/about/page.tsx", "export default function A(){return null}")
	write(t, dir, "public/logo.svg", "<svg/>")

	res, err := (&LinksGate{}).Check(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if res.Passed {
		t.Fatal("expected failure for /missing")
	}
	if len(res.Findings) != 1 {
		t.Fatalf("want 1 finding, got %d: %+v", len(res.Findings), res.Findings)
	}
	if res.Findings[0].Message != "internal link /missing has no matching route or public file" {
		t.Fatalf("unexpected finding: %+v", res.Findings[0])
	}
}

func TestSEOGate(t *testing.T) {
	dir := t.TempDir()
	// bare app dir: everything missing
	write(t, dir, "app/page.tsx", "export default function P(){return null}")
	res, _ := (&SEOGate{}).Check(context.Background(), dir)
	if res.Passed {
		t.Fatalf("expected failures, got pass: %+v", res.Findings)
	}

	// complete project: pass (JSON-LD present so no warning either)
	dir2 := t.TempDir()
	write(t, dir2, "app/page.tsx", `<script type="application/ld+json"/>`)
	write(t, dir2, "app/layout.tsx", `export const metadata = { title: "t", description: "d", openGraph: {} }`)
	write(t, dir2, "app/robots.ts", "export default function robots(){}")
	write(t, dir2, "app/sitemap.ts", "export default function sitemap(){}")
	res, _ = (&SEOGate{}).Check(context.Background(), dir2)
	if !res.Passed {
		t.Fatalf("expected pass, findings: %+v", res.Findings)
	}
	if len(res.Findings) != 0 {
		t.Fatalf("expected no findings, got: %+v", res.Findings)
	}
}

func TestSEOGateWarningDoesNotFail(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "app/page.tsx", "export default function P(){return null}")
	write(t, dir, "app/layout.tsx", `export const metadata = { title: "t", description: "d" }`) // no openGraph, no JSON-LD
	write(t, dir, "app/robots.ts", "x")
	write(t, dir, "app/sitemap.ts", "x")
	res, _ := (&SEOGate{}).Check(context.Background(), dir)
	if !res.Passed {
		t.Fatalf("warnings must not fail the gate: %+v", res.Findings)
	}
	if len(res.Findings) != 2 { // openGraph warning + JSON-LD warning
		t.Fatalf("want 2 warnings, got %d: %+v", len(res.Findings), res.Findings)
	}
}
