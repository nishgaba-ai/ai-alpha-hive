package cli

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/spf13/cobra"
)

type toolCheck struct {
	name     string
	args     []string
	required bool
	hint     string
}

var toolChecks = []toolCheck{
	{"git", []string{"--version"}, true, "install git: https://git-scm.com"},
	{"node", []string{"--version"}, true, "install Node.js >= 20: https://nodejs.org"},
	{"npm", []string{"--version"}, true, "ships with Node.js"},
	{"vercel", []string{"--version"}, false, "npm i -g vercel (needed for `hive ship --driver vercel`)"},
}

func newDoctorCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "doctor",
		Short: "Diagnose the local environment hive depends on",
		RunE: func(cmd *cobra.Command, args []string) error {
			out := cmd.OutOrStdout()
			failures := 0
			for _, t := range toolChecks {
				version, err := runTool(t.name, t.args...)
				switch {
				case err == nil:
					fmt.Fprintf(out, "  ok       %-8s %s\n", t.name, version)
				case t.required:
					failures++
					fmt.Fprintf(out, "  MISSING  %-8s %s\n", t.name, t.hint)
				default:
					fmt.Fprintf(out, "  optional %-8s not found — %s\n", t.name, t.hint)
				}
			}
			if failures > 0 {
				return fmt.Errorf("%d required tool(s) missing", failures)
			}
			fmt.Fprintln(out, "environment looks good")
			return nil
		},
	}
}

func runTool(name string, args ...string) (string, error) {
	b, err := exec.Command(name, args...).Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(strings.SplitN(string(b), "\n", 2)[0]), nil
}
