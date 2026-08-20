package gates

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Helpers shared by the web-project gates (types, lint, build, links, seo).

func hasFile(dir string, name string) bool {
	_, err := os.Stat(filepath.Join(dir, name))
	return err == nil
}

func isWebProject(dir string) bool { return hasFile(dir, "package.json") }

func hasNodeModules(dir string) bool { return hasFile(dir, "node_modules") }

// packageJSON is the subset of package.json the gates care about.
type packageJSON struct {
	Scripts map[string]string `json:"scripts"`
}

func readPackageJSON(dir string) (*packageJSON, error) {
	b, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return nil, err
	}
	var p packageJSON
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// runCmd executes a toolchain command in dir, returning combined output.
// On Windows, npm/npx are .cmd shims, so route through cmd.exe.
func runCmd(ctx context.Context, dir string, name string, args ...string) (string, error) {
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd", append([]string{"/C", name}, args...)...)
	} else {
		cmd = exec.CommandContext(ctx, name, args...)
	}
	cmd.Dir = dir
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return out.String(), err
}

// finalize sets Passed from the findings: warnings don't fail a gate.
func finalize(r *Result) {
	r.Passed = true
	for _, f := range r.Findings {
		if f.Severity == SeverityError {
			r.Passed = false
			return
		}
	}
}

// tail returns the last n lines of s, for compact failure findings.
func tail(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
