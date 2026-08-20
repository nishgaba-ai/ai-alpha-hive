// Package scaffold renders embedded site templates into new projects.
//
// Template files are Go text/templates with [[ ]] delimiters — chosen because
// {{ }} collides with JSX object literals (style={{...}}).
package scaffold

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"text/template"
)

//go:embed all:templates
var templatesFS embed.FS

// Vars are the substitutions available to template files.
type Vars struct {
	Name   string // display name, e.g. "Sunrise Bakery"
	Slug   string // directory/package-safe name, e.g. "sunrise-bakery"
	Intent string // one-line site intent
}

// Templates lists available template names.
func Templates() []string {
	entries, err := templatesFS.ReadDir("templates")
	if err != nil {
		return nil
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names
}

var slugRe = regexp.MustCompile(`[^a-z0-9-]+`)

// Slugify turns a display name into a package/dir-safe slug.
func Slugify(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = strings.ReplaceAll(s, " ", "-")
	s = slugRe.ReplaceAllString(s, "")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "site"
	}
	return s
}

// Render writes template tpl into dir (which must not already exist).
func Render(tpl, dir string, vars Vars) error {
	root := "templates/" + tpl
	if _, err := templatesFS.ReadDir(root); err != nil {
		return fmt.Errorf("unknown template %q (available: %s)", tpl, strings.Join(Templates(), ", "))
	}
	if _, err := os.Stat(dir); err == nil {
		return fmt.Errorf("target %s already exists", dir)
	}

	return fs.WalkDir(templatesFS, root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel := strings.TrimPrefix(path, root)
		rel = strings.TrimPrefix(rel, "/")
		// go:embed refuses names like .gitignore unless aliased
		rel = strings.ReplaceAll(rel, "dot-", ".")
		target := filepath.Join(dir, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		raw, err := templatesFS.ReadFile(path)
		if err != nil {
			return err
		}
		t, err := template.New(rel).Delims("[[", "]]").Parse(string(raw))
		if err != nil {
			return fmt.Errorf("template %s: %w", rel, err)
		}
		f, err := os.Create(target)
		if err != nil {
			return err
		}
		defer f.Close()
		return t.Execute(f, vars)
	})
}
