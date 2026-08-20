// Package gates defines hive's policy gates: deterministic checks every
// project must pass before `hive ship` will deploy it.
//
// Gates emit machine-readable findings with fix hints so an agent can loop
// check → fix → re-check without human interpretation.
package gates

import "context"

// Severity of a finding.
type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
)

// Finding is one problem a gate discovered.
type Finding struct {
	File     string   `json:"file,omitempty"`
	Line     int      `json:"line,omitempty"`
	Severity Severity `json:"severity"`
	Message  string   `json:"message"`
	FixHint  string   `json:"fix_hint,omitempty"`
}

// Result of running one gate.
type Result struct {
	Gate     string    `json:"gate"`
	Passed   bool      `json:"passed"`
	Skipped  bool      `json:"skipped,omitempty"`
	Findings []Finding `json:"findings,omitempty"`
}

// Gate is a deterministic project check.
type Gate interface {
	// Name is the stable identifier used in --gate and reports.
	Name() string
	// Description explains what the gate enforces.
	Description() string
	// Blocking gates fail `hive ship`; non-blocking gates only warn.
	Blocking() bool
	// Check inspects the project rooted at dir.
	Check(ctx context.Context, dir string) (Result, error)
}

// Registry returns the built-in gates, in reporting order.
// Phase 1 adds types, lint, build, links, seo; phase 2 adds drift.
func Registry() []Gate {
	return []Gate{
		&SecretsGate{},
	}
}

// ByName finds a registered gate.
func ByName(name string) (Gate, bool) {
	for _, g := range Registry() {
		if g.Name() == name {
			return g, true
		}
	}
	return nil, false
}
