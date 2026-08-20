package gates

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// LinksGate verifies internal links in source point at routes or public
// files that actually exist.
type LinksGate struct{}

func (g *LinksGate) Name() string        { return "links" }
func (g *LinksGate) Blocking() bool      { return true }
func (g *LinksGate) Mutates() bool       { return false }
func (g *LinksGate) Description() string { return "no broken internal links" }

var hrefRe = regexp.MustCompile(`href=["'](/[^"'#?]*)`)

func (g *LinksGate) Check(ctx context.Context, dir string) (Result, error) {
	res := Result{Gate: g.Name()}
	appDir := filepath.Join(dir, "app")
	if _, err := os.Stat(appDir); err != nil {
		res.Skipped, res.Passed = true, true
		return res, nil
	}

	routes := collectRoutes(appDir)
	publicFiles := collectPublic(filepath.Join(dir, "public"))

	seen := map[string]bool{}
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		ext := filepath.Ext(path)
		if ext != ".tsx" && ext != ".jsx" && ext != ".mdx" {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(dir, path)
		for _, m := range hrefRe.FindAllStringSubmatch(string(b), -1) {
			link := strings.TrimSuffix(m[1], "/")
			if link == "" {
				link = "/"
			}
			if routes[link] || publicFiles[link] || seen[rel+link] {
				continue
			}
			seen[rel+link] = true
			res.Findings = append(res.Findings, Finding{
				File: filepath.ToSlash(rel), Severity: SeverityError,
				Message: "internal link " + link + " has no matching route or public file",
				FixHint: "create app" + link + "/page.tsx, fix the href, or add the file under public/",
			})
		}
		return nil
	})
	finalize(&res)
	return res, err
}

func collectRoutes(appDir string) map[string]bool {
	routes := map[string]bool{}
	filepath.WalkDir(appDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		name := d.Name()
		if name != "page.tsx" && name != "page.jsx" && name != "page.mdx" {
			return nil
		}
		rel, _ := filepath.Rel(appDir, filepath.Dir(path))
		route := "/" + filepath.ToSlash(rel)
		if route == "/." {
			route = "/"
		}
		// route groups (marketing) don't appear in URLs
		var parts []string
		for _, p := range strings.Split(strings.TrimPrefix(route, "/"), "/") {
			if p == "" || (strings.HasPrefix(p, "(") && strings.HasSuffix(p, ")")) {
				continue
			}
			parts = append(parts, p)
		}
		routes["/"+strings.Join(parts, "/")] = true
		return nil
	})
	routes["/"] = routes["/"] || hasPage(appDir)
	return routes
}

func hasPage(appDir string) bool {
	for _, n := range []string{"page.tsx", "page.jsx", "page.mdx"} {
		if _, err := os.Stat(filepath.Join(appDir, n)); err == nil {
			return true
		}
	}
	return false
}

func collectPublic(publicDir string) map[string]bool {
	files := map[string]bool{}
	filepath.WalkDir(publicDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(publicDir, path)
		files["/"+filepath.ToSlash(rel)] = true
		return nil
	})
	return files
}
