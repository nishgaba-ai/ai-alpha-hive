package gates

import (
	"context"

	"golang.org/x/sync/errgroup"
)

// RunAll executes the registered gates and returns results in registry
// order: read-only gates run in parallel, then gates that mutate the project
// directory run serially so they never race on generated files (e.g. tsc
// reading .next/types while next build rewrites it).
// A gate that errors (as opposed to failing) aborts the run.
func RunAll(ctx context.Context, dir string) ([]Result, error) {
	reg := Registry()
	results := make([]Result, len(reg))

	g, gctx := errgroup.WithContext(ctx)
	for i, gate := range reg {
		if gate.Mutates() {
			continue
		}
		g.Go(func() error {
			r, err := gate.Check(gctx, dir)
			if err != nil {
				return err
			}
			results[i] = r
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}

	for i, gate := range reg {
		if !gate.Mutates() {
			continue
		}
		r, err := gate.Check(ctx, dir)
		if err != nil {
			return nil, err
		}
		results[i] = r
	}
	return results, nil
}

// Blocked reports whether any blocking gate failed.
func Blocked(results []Result) bool {
	for _, r := range results {
		if r.Skipped || r.Passed {
			continue
		}
		if g, ok := ByName(r.Gate); ok && g.Blocking() {
			return true
		}
	}
	return false
}
