package gates

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Fixture values are assembled at runtime so no secret-shaped literal exists
// in this file — otherwise GitHub push protection (and our own gate) would
// flag the test itself.
var (
	fakeAWSKey    = "AKIA" + strings.Repeat("A", 16)
	fakeStripeKey = "sk_live_" + strings.Repeat("a", 24)
)

func TestSecretsGate(t *testing.T) {
	cases := []struct {
		name     string
		file     string
		content  string
		findings int
	}{
		{"clean file", "app.ts", "export const region = process.env.AWS_REGION;\n", 0},
		{"aws key", "config.ts", `const key = "` + fakeAWSKey + `";` + "\n", 1},
		{"hardcoded assignment", "auth.ts", `const apiKey = "abcd1234efgh5678ijkl";` + "\n", 1},
		{"env file leak", ".env.local", "STRIPE_KEY=" + fakeStripeKey + "\n", 1},
		{"private key", "deploy.md", "-----BEGIN RSA PRIVATE KEY-----\n", 1},
		{"allow escape hatch", "fixture.ts", `const key = "` + fakeAWSKey + `"; // hive:allow-secret test fixture` + "\n", 0},
		{"binary-ish ext ignored", "logo.png", fakeAWSKey, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, tc.file), []byte(tc.content), 0o644); err != nil {
				t.Fatal(err)
			}
			res, err := (&SecretsGate{}).Check(context.Background(), dir)
			if err != nil {
				t.Fatal(err)
			}
			if len(res.Findings) != tc.findings {
				t.Fatalf("want %d findings, got %d: %+v", tc.findings, len(res.Findings), res.Findings)
			}
			if (tc.findings == 0) != res.Passed {
				t.Fatalf("Passed=%v inconsistent with %d findings", res.Passed, tc.findings)
			}
		})
	}
}

func TestSecretsGateSkipsNodeModules(t *testing.T) {
	dir := t.TempDir()
	nm := filepath.Join(dir, "node_modules", "pkg")
	if err := os.MkdirAll(nm, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nm, "index.js"), []byte(`const k = "`+fakeAWSKey+`";`), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := (&SecretsGate{}).Check(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Passed {
		t.Fatalf("node_modules should be skipped, got findings: %+v", res.Findings)
	}
}
