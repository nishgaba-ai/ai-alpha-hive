package deploy

import "testing"

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Bakery Demo":   "bakery-demo",
		"  Café Nine! ": "caf-nine",
		"UPPER":         "upper",
	}
	for in, want := range cases {
		if got := slugify(in); got != want {
			t.Errorf("slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDomainValidation(t *testing.T) {
	valid := []string{"nishgaba.com", "sub.domain.co.in", "a-b.example.org"}
	invalid := []string{"evil.com; rm -rf /", "spa ce.com", "$(cmd).com", "back`tick.com"}
	for _, d := range valid {
		if !domainRe.MatchString(d) {
			t.Errorf("%q should be valid", d)
		}
	}
	for _, d := range invalid {
		if domainRe.MatchString(d) {
			t.Errorf("%q must be rejected (shell-injection surface)", d)
		}
	}
}

func TestDropletPreflightRequiresHost(t *testing.T) {
	t.Setenv("DROPLET_HOST", "")
	if err := (&DropletDriver{}).Preflight(); err == nil {
		t.Fatal("expected error without DROPLET_HOST")
	}
}
