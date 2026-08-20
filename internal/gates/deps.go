package gates

import "context"

// DepsGate ensures a web project's dependencies are installed, so the
// toolchain gates (types, lint, build) run against real modules.
type DepsGate struct{}

func (g *DepsGate) Name() string        { return "deps" }
func (g *DepsGate) Blocking() bool      { return true }
func (g *DepsGate) Mutates() bool       { return false }
func (g *DepsGate) Description() string { return "node_modules present for web projects" }

func (g *DepsGate) Check(ctx context.Context, dir string) (Result, error) {
	res := Result{Gate: g.Name()}
	if !isWebProject(dir) {
		res.Skipped, res.Passed = true, true
		return res, nil
	}
	if !hasNodeModules(dir) {
		res.Findings = append(res.Findings, Finding{
			File:     "package.json",
			Severity: SeverityError,
			Message:  "dependencies are not installed",
			FixHint:  "run `npm install` in the project root",
		})
	}
	finalize(&res)
	return res, nil
}
