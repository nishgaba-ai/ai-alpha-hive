package gates

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

const maxToolFindings = 20

// TypesGate runs the TypeScript compiler.
type TypesGate struct{}

func (g *TypesGate) Name() string        { return "types" }
func (g *TypesGate) Blocking() bool      { return true }
func (g *TypesGate) Description() string { return "tsc --noEmit is clean" }

// e.g. app/page.tsx(12,7): error TS2304: Cannot find name 'foo'.
var tscErrRe = regexp.MustCompile(`^(.+)\((\d+),\d+\): error (TS\d+: .+)$`)

func (g *TypesGate) Check(ctx context.Context, dir string) (Result, error) {
	res := Result{Gate: g.Name()}
	if !isWebProject(dir) || !hasFile(dir, "tsconfig.json") || !hasNodeModules(dir) {
		res.Skipped, res.Passed = true, true
		return res, nil
	}
	out, err := runCmd(ctx, dir, "npx", "--no-install", "tsc", "--noEmit")
	if err == nil {
		res.Passed = true
		return res, nil
	}
	for _, line := range strings.Split(out, "\n") {
		m := tscErrRe.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		lineNo, _ := strconv.Atoi(m[2])
		res.Findings = append(res.Findings, Finding{
			File: m[1], Line: lineNo, Severity: SeverityError,
			Message: m[3], FixHint: "fix the type error; do not add ts-ignore",
		})
		if len(res.Findings) >= maxToolFindings {
			break
		}
	}
	if len(res.Findings) == 0 { // tsc failed without parseable errors
		res.Findings = append(res.Findings, Finding{
			Severity: SeverityError, Message: "tsc failed: " + tail(out, 10),
		})
	}
	finalize(&res)
	return res, nil
}

// LintGate runs eslint with JSON output.
type LintGate struct{}

func (g *LintGate) Name() string        { return "lint" }
func (g *LintGate) Blocking() bool      { return true }
func (g *LintGate) Description() string { return "eslint is clean" }

type eslintFile struct {
	FilePath string `json:"filePath"`
	Messages []struct {
		RuleID   string `json:"ruleId"`
		Severity int    `json:"severity"` // 1 warn, 2 error
		Message  string `json:"message"`
		Line     int    `json:"line"`
	} `json:"messages"`
}

func hasESLintConfig(dir string) bool {
	for _, f := range []string{"eslint.config.mjs", "eslint.config.js", "eslint.config.ts", ".eslintrc.json", ".eslintrc.js"} {
		if hasFile(dir, f) {
			return true
		}
	}
	return false
}

func (g *LintGate) Check(ctx context.Context, dir string) (Result, error) {
	res := Result{Gate: g.Name()}
	if !isWebProject(dir) || !hasESLintConfig(dir) || !hasNodeModules(dir) {
		res.Skipped, res.Passed = true, true
		return res, nil
	}
	out, runErr := runCmd(ctx, dir, "npx", "--no-install", "eslint", ".", "--format", "json")
	// eslint exits 1 when findings exist; JSON is still on stdout.
	start := strings.Index(out, "[")
	if start < 0 {
		res.Findings = append(res.Findings, Finding{
			Severity: SeverityError, Message: "eslint failed to run: " + tail(out, 10),
		})
		finalize(&res)
		return res, nil
	}
	var files []eslintFile
	if err := json.Unmarshal([]byte(out[start:]), &files); err != nil {
		res.Findings = append(res.Findings, Finding{
			Severity: SeverityError, Message: "eslint output unparseable: " + err.Error(),
		})
		finalize(&res)
		return res, nil
	}
	for _, f := range files {
		for _, m := range f.Messages {
			sev := SeverityWarning
			if m.Severity == 2 {
				sev = SeverityError
			}
			msg := m.Message
			if m.RuleID != "" {
				msg += " (" + m.RuleID + ")"
			}
			res.Findings = append(res.Findings, Finding{
				File: relTo(dir, f.FilePath), Line: m.Line, Severity: sev,
				Message: msg, FixHint: "fix the lint issue; do not disable the rule",
			})
			if len(res.Findings) >= maxToolFindings {
				finalize(&res)
				return res, nil
			}
		}
	}
	_ = runErr
	finalize(&res)
	return res, nil
}

// BuildGate runs the project's build script.
type BuildGate struct{}

func (g *BuildGate) Name() string        { return "build" }
func (g *BuildGate) Blocking() bool      { return true }
func (g *BuildGate) Description() string { return "production build succeeds" }

func (g *BuildGate) Check(ctx context.Context, dir string) (Result, error) {
	res := Result{Gate: g.Name()}
	if !isWebProject(dir) || !hasNodeModules(dir) {
		res.Skipped, res.Passed = true, true
		return res, nil
	}
	pkg, err := readPackageJSON(dir)
	if err != nil || pkg.Scripts["build"] == "" {
		res.Skipped, res.Passed = true, true
		return res, nil
	}
	out, runErr := runCmd(ctx, dir, "npm", "run", "build")
	if runErr != nil {
		res.Findings = append(res.Findings, Finding{
			Severity: SeverityError,
			Message:  "build failed:\n" + tail(out, 25),
			FixHint:  "read the build output above and fix the underlying error",
		})
	}
	finalize(&res)
	return res, nil
}
