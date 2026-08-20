package gates

import (
	"context"

	"golang.org/x/sync/errgroup"
)

// RunAll executes every registered gate in parallel and returns results in
// registry order. A gate that errors (as opposed to failing) aborts the run.
func RunAll(ctx context.Context, dir string) ([]Result, error) {
	reg := Registry()
	results := make([]Result, len(reg))
	g, ctx := errgroup.WithContext(ctx)
	for i, gate := range reg {
		g.Go(func() error {
			r, err := gate.Check(ctx, dir)
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
