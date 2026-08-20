package cli

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/nishgaba-ai/ai-alpha-hive/internal/scaffold"
	"github.com/spf13/cobra"
)

func newNewCmd() *cobra.Command {
	var intent string
	var noInstall bool
	cmd := &cobra.Command{
		Use:   "new <template> <name>",
		Short: "Scaffold a new site from a template",
		Long:  "Templates: " + strings.Join(scaffold.Templates(), ", "),
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			tpl, name := args[0], args[1]
			slug := scaffold.Slugify(name)
			if intent == "" {
				intent = "Describe what visitors should do here — then keep hive.yaml current."
			}
			dir, err := filepath.Abs(slug)
			if err != nil {
				return err
			}

			fmt.Fprintf(cmd.OutOrStdout(), "scaffolding %s from template %q…\n", slug, tpl)
			if err := scaffold.Render(tpl, dir, scaffold.Vars{Name: name, Slug: slug, Intent: intent}); err != nil {
				return err
			}

			if !noInstall {
				fmt.Fprintln(cmd.OutOrStdout(), "installing dependencies (npm install)…")
				if out, err := npmInstall(dir); err != nil {
					return fmt.Errorf("npm install failed:\n%s", out)
				}
			}

			fmt.Fprintf(cmd.OutOrStdout(), "\nready. next steps:\n  cd %s\n  hive check\n  hive ship\n", slug)
			return nil
		},
	}
	cmd.Flags().StringVar(&intent, "intent", "", "one-line site intent (what should visitors do?)")
	cmd.Flags().BoolVar(&noInstall, "no-install", false, "skip npm install")
	return cmd
}

func npmInstall(dir string) (string, error) {
	var c *exec.Cmd
	if runtime.GOOS == "windows" {
		c = exec.Command("cmd", "/C", "npm", "install", "--no-fund", "--no-audit")
	} else {
		c = exec.Command("npm", "install", "--no-fund", "--no-audit")
	}
	c.Dir = dir
	out, err := c.CombinedOutput()
	return string(out), err
}
