package cli

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/nishgaba-ai/ai-alpha-hive/internal/gates"
	"github.com/spf13/cobra"
)

func newCheckCmd() *cobra.Command {
	var asJSON bool
	var only string
	cmd := &cobra.Command{
		Use:   "check",
		Short: "Run policy gates against the current project",
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, err := os.Getwd()
			if err != nil {
				return err
			}

			var results []gates.Result
			if only != "" {
				gate, ok := gates.ByName(only)
				if !ok {
					return fmt.Errorf("unknown gate %q (see `hive check --help`)", only)
				}
				r, err := gate.Check(cmd.Context(), dir)
				if err != nil {
					return err
				}
				results = []gates.Result{r}
			} else {
				results, err = gates.RunAll(cmd.Context(), dir)
				if err != nil {
					return err
				}
			}

			out := cmd.OutOrStdout()
			if asJSON {
				enc := json.NewEncoder(out)
				enc.SetIndent("", "  ")
				if err := enc.Encode(results); err != nil {
					return err
				}
			} else {
				for _, r := range results {
					status := "pass"
					if !r.Passed {
						status = "FAIL"
					}
					fmt.Fprintf(out, "  %-4s %s\n", status, r.Gate)
					for _, f := range r.Findings {
						fmt.Fprintf(out, "         %s:%d  %s\n", f.File, f.Line, f.Message)
						if f.FixHint != "" {
							fmt.Fprintf(out, "                fix: %s\n", f.FixHint)
						}
					}
				}
			}

			if gates.Blocked(results) {
				return fmt.Errorf("blocking gate failed — hive ship would refuse this build")
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "emit machine-readable findings (for agents)")
	cmd.Flags().StringVar(&only, "gate", "", "run a single gate by name")
	return cmd
}
