package gates

import (
	"bufio"
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// SecretsGate scans project files for credentials that must never ship.
type SecretsGate struct{}

func (g *SecretsGate) Name() string        { return "secrets" }
func (g *SecretsGate) Blocking() bool      { return true }
func (g *SecretsGate) Mutates() bool       { return false }
func (g *SecretsGate) Description() string { return "no credentials or private keys in tracked files" }

type secretPattern struct {
	name string
	re   *regexp.Regexp
}

var secretPatterns = []secretPattern{
	{"AWS access key", regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`)},
	{"private key block", regexp.MustCompile(`-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----`)},
	{"Stripe live key", regexp.MustCompile(`\bsk_live_[0-9a-zA-Z]{20,}\b`)},
	{"Anthropic API key", regexp.MustCompile(`\bsk-ant-[0-9a-zA-Z_-]{20,}\b`)},
	{"GitHub token", regexp.MustCompile(`\bgh[pousr]_[0-9A-Za-z]{30,}\b`)},
	{"Slack token", regexp.MustCompile(`\bxox[bpoas]-[0-9A-Za-z-]{10,}\b`)},
	{"hardcoded secret assignment", regexp.MustCompile(`(?i)\b(api[_-]?key|secret|password|token)\b\s*[:=]\s*["'][A-Za-z0-9+/_-]{16,}["']`)},
}

var skipDirs = map[string]bool{
	".git": true, "node_modules": true, ".next": true, "dist": true,
	"build": true, ".hive": true, "vendor": true,
}

var textExts = map[string]bool{
	".go": true, ".ts": true, ".tsx": true, ".js": true, ".jsx": true,
	".json": true, ".yaml": true, ".yml": true, ".md": true, ".mdx": true,
	".env": true, ".toml": true, ".html": true, ".css": true, ".sh": true,
}

func (g *SecretsGate) Check(ctx context.Context, dir string) (Result, error) {
	res := Result{Gate: g.Name(), Passed: true}
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable entries are not findings
		}
		if d.IsDir() {
			if skipDirs[d.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		ext := strings.ToLower(filepath.Ext(path))
		base := d.Name()
		// .env files are the classic leak; also scan extensionless dotfiles like .env.local
		if !textExts[ext] && !strings.HasPrefix(base, ".env") {
			return nil
		}
		rel, _ := filepath.Rel(dir, path)
		findings := scanFile(path, rel)
		if len(findings) > 0 {
			res.Findings = append(res.Findings, findings...)
			res.Passed = false
		}
		return nil
	})
	return res, err
}

func scanFile(path, rel string) []Finding {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	var findings []Finding
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	lineNo := 0
	for sc.Scan() {
		lineNo++
		line := sc.Text()
		if strings.Contains(line, "hive:allow-secret") { // explicit, auditable escape hatch
			continue
		}
		for _, p := range secretPatterns {
			if p.re.MatchString(line) {
				findings = append(findings, Finding{
					File:     filepath.ToSlash(rel),
					Line:     lineNo,
					Severity: SeverityError,
					Message:  p.name + " found in source",
					FixHint:  "move the value to an environment variable and reference it; never commit real credentials",
				})
			}
		}
	}
	return findings
}
