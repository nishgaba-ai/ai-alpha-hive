package gates

import (
	"context"
	"strings"
)

// TestGate runs the project's own test suite when one exists.
type TestGate struct{}

func (g *TestGate) Name() string        { return "test" }
func (g *TestGate) Blocking() bool      { return true }
func (g *TestGate) Description() string { return "the project's test script passes" }

// Test runs may write caches/coverage into the project directory.
func (g *TestGate) Mutates() bool { return true }

func (g *TestGate) Check(ctx context.Context, dir string) (Result, error) {
	res := Result{Gate: g.Name()}
	if !isWebProject(dir) || !hasNodeModules(dir) {
		res.Skipped, res.Passed = true, true
		return res, nil
	}
	pkg, err := readPackageJSON(dir)
	if err != nil {
		res.Skipped, res.Passed = true, true
		return res, nil
	}
	script := pkg.Scripts["test"]
	// npm's default placeholder script always exits 1 — that's "no tests",
	// not "failing tests".
	if script == "" || strings.Contains(script, "no test specified") {
		res.Skipped, res.Passed = true, true
		return res, nil
	}
	out, runErr := runCmd(ctx, dir, "npm", "test")
	if runErr != nil {
		res.Findings = append(res.Findings, Finding{
			Severity: SeverityError,
			Message:  "tests failed:\n" + tail(out, 25),
			FixHint:  "fix the failing tests; never delete or skip them to pass the gate",
		})
	}
	finalize(&res)
	return res, nil
}
