// Package deploy ships built projects through pluggable drivers.
package deploy

import "context"

// Options for a deployment.
type Options struct {
	Prod      bool   // production deployment; otherwise preview
	ReleaseID string // timestamped id assigned by ship, used for release dirs/tags
}

// Driver deploys the project rooted at dir and returns the live URL.
type Driver interface {
	Name() string
	// Preflight validates configuration (tokens, tooling) before gates run,
	// so a doomed ship fails fast with a clear message.
	Preflight() error
	Deploy(ctx context.Context, dir string, opts Options) (string, error)
}

// ByName resolves a registered driver.
func ByName(name string) (Driver, bool) {
	switch name {
	case "vercel":
		return &VercelDriver{}, true
	case "droplet":
		return &DropletDriver{}, true
	default:
		return nil, false
	}
}
