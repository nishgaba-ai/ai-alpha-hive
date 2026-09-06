package cli

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/spf13/cobra"
)

// hive company … delegates to the TypeScript runtime (runtime/). The Go
// side stays thin: it finds the runtime, prefers the built CLI, falls back
// to tsx for development, and passes every argument through.
func newCompanyCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:                "company [command]",
		Short:              "Launch and run a company of agents (runtime/)",
		Long:               "Companies of agents: init, validate, run, mission, status, approve, deny, secret, integrations, export, import, doctor.\nAll arguments are passed to the runtime CLI. Set HIVE_RUNTIME_DIR to point at a checkout of runtime/.",
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, err := runtimeDir()
			if err != nil {
				return err
			}
			var c *exec.Cmd
			built := filepath.Join(dir, "dist", "src", "cli.js")
			if _, err := os.Stat(built); err == nil {
				c = exec.Command("node", append([]string{built}, args...)...)
			} else if _, err := os.Stat(filepath.Join(dir, "node_modules", ".bin", "tsx")); err == nil {
				c = exec.Command("npx", append([]string{"tsx", filepath.Join(dir, "src", "cli.ts")}, args...)...)
			} else {
				return fmt.Errorf("runtime at %s is not built: run `npm install && npm run build` there", dir)
			}
			c.Stdin, c.Stdout, c.Stderr = os.Stdin, os.Stdout, os.Stderr
			c.Env = os.Environ()
			return c.Run()
		},
	}
	return cmd
}

func runtimeDir() (string, error) {
	if d := os.Getenv("HIVE_RUNTIME_DIR"); d != "" {
		return d, nil
	}
	// Walk up from the working directory looking for runtime/package.json
	// (a checkout of the framework repo), then next to the binary.
	wd, _ := os.Getwd()
	for p := wd; p != filepath.Dir(p); p = filepath.Dir(p) {
		if _, err := os.Stat(filepath.Join(p, "runtime", "package.json")); err == nil {
			return filepath.Join(p, "runtime"), nil
		}
	}
	if exe, err := os.Executable(); err == nil {
		p := filepath.Join(filepath.Dir(exe), "runtime")
		if _, err := os.Stat(filepath.Join(p, "package.json")); err == nil {
			return p, nil
		}
	}
	return "", errors.New("cannot find runtime/: set HIVE_RUNTIME_DIR to the runtime directory of an ai-alpha-hive checkout")
}
