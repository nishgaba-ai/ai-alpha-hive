package gates

import (
	"context"
	"os"
	"path/filepath"
	"strings"
)

// SEOGate enforces the structural SEO floor every shipped site must have.
type SEOGate struct{}

func (g *SEOGate) Name() string        { return "seo" }
func (g *SEOGate) Blocking() bool      { return true }
func (g *SEOGate) Mutates() bool       { return false }
func (g *SEOGate) Description() string { return "metadata, robots, sitemap, and structured data present" }

func (g *SEOGate) Check(ctx context.Context, dir string) (Result, error) {
	res := Result{Gate: g.Name()}
	appDir := filepath.Join(dir, "app")
	if _, err := os.Stat(appDir); err != nil {
		res.Skipped, res.Passed = true, true
		return res, nil
	}

	layout := readIfExists(filepath.Join(appDir, "layout.tsx"))
	switch {
	case layout == "":
		res.Findings = append(res.Findings, Finding{
			File: "app/layout.tsx", Severity: SeverityError,
			Message: "no root layout found",
			FixHint: "add app/layout.tsx with an exported metadata object",
		})
	case !strings.Contains(layout, "export const metadata"):
		res.Findings = append(res.Findings, Finding{
			File: "app/layout.tsx", Severity: SeverityError,
			Message: "root layout does not export metadata",
			FixHint: "export const metadata: Metadata = { title, description, openGraph } from app/layout.tsx",
		})
	default:
		if !strings.Contains(layout, "description") {
			res.Findings = append(res.Findings, Finding{
				File: "app/layout.tsx", Severity: SeverityError,
				Message: "metadata has no description",
				FixHint: "add a description (and openGraph block) to the metadata export",
			})
		}
		if !strings.Contains(layout, "openGraph") {
			res.Findings = append(res.Findings, Finding{
				File: "app/layout.tsx", Severity: SeverityWarning,
				Message: "metadata has no openGraph block — link previews will be bare",
				FixHint: "add openGraph { title, description, url, siteName, type } to metadata",
			})
		}
	}

	if !hasAny(appDir, "robots.ts", "robots.txt") && !hasFile(filepath.Join(dir, "public"), "robots.txt") {
		res.Findings = append(res.Findings, Finding{
			File: "app/robots.ts", Severity: SeverityError,
			Message: "no robots file — crawlers (including AI crawlers) get no guidance",
			FixHint: "add app/robots.ts returning MetadataRoute.Robots with a sitemap reference",
		})
	}
	if !hasAny(appDir, "sitemap.ts", "sitemap.xml") {
		res.Findings = append(res.Findings, Finding{
			File: "app/sitemap.ts", Severity: SeverityError,
			Message: "no sitemap",
			FixHint: "add app/sitemap.ts returning MetadataRoute.Sitemap",
		})
	}

	if !projectContains(dir, "application/ld+json") {
		res.Findings = append(res.Findings, Finding{
			Severity: SeverityWarning,
			Message:  "no JSON-LD structured data found — weaker AI/search citability",
			FixHint:  "add a schema.org script (Organization/Article/FAQ) to the relevant pages",
		})
	}

	finalize(&res)
	return res, nil
}

func readIfExists(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}

func hasAny(dir string, names ...string) bool {
	for _, n := range names {
		if hasFile(dir, n) {
			return true
		}
	}
	return false
}

func projectContains(dir, needle string) bool {
	found := false
	filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || found {
			return filepath.SkipAll
		}
		if d.IsDir() {
			if skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		ext := filepath.Ext(path)
		if ext != ".tsx" && ext != ".jsx" && ext != ".ts" && ext != ".html" {
			return nil
		}
		if b, err := os.ReadFile(path); err == nil && strings.Contains(string(b), needle) {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	return found
}

func relTo(dir, path string) string {
	if rel, err := filepath.Rel(dir, path); err == nil {
		return filepath.ToSlash(rel)
	}
	return filepath.ToSlash(path)
}
