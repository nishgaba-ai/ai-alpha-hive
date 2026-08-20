package scaffold

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Sunrise Bakery": "sunrise-bakery",
		"  Café Nine!  ": "caf-nine",
		"---":            "site",
	}
	for in, want := range cases {
		if got := Slugify(in); got != want {
			t.Errorf("Slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRenderMarketing(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "demo")
	vars := Vars{Name: "Sunrise Bakery", Slug: "sunrise-bakery", Intent: "Order cakes on WhatsApp"}
	if err := Render("marketing", dir, vars); err != nil {
		t.Fatal(err)
	}

	// dot- aliasing produced a real .gitignore
	if _, err := os.Stat(filepath.Join(dir, ".gitignore")); err != nil {
		t.Error("missing .gitignore (dot- aliasing broken)")
	}

	// every rendered text file is fully substituted
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(b), "[[.") {
			t.Errorf("%s contains unrendered template vars", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	layout, _ := os.ReadFile(filepath.Join(dir, "app", "layout.tsx"))
	if !strings.Contains(string(layout), "Sunrise Bakery") {
		t.Error("layout.tsx missing substituted name")
	}
	pkg, _ := os.ReadFile(filepath.Join(dir, "package.json"))
	if !strings.Contains(string(pkg), `"name": "sunrise-bakery"`) {
		t.Error("package.json missing slug")
	}
}

func TestRenderUnknownTemplate(t *testing.T) {
	if err := Render("nope", t.TempDir()+"/x", Vars{}); err == nil {
		t.Fatal("expected error for unknown template")
	}
}

func TestRenderRefusesExistingDir(t *testing.T) {
	dir := t.TempDir()
	if err := Render("marketing", dir, Vars{Name: "x", Slug: "x"}); err == nil {
		t.Fatal("expected error for existing target")
	}
}
