package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

// Phase 1 commands, present so the CLI surface is stable from day one.

func newNewCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "new <template> <name>",
		Short: "Scaffold a new site from a template (phase 1)",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			return fmt.Errorf("`hive new` lands in phase 1 (templates: marketing, blog, store, docs, portfolio) — see MASTER-PLAN.md §11")
		},
	}
}

func newShipCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "ship",
		Short: "Run gates, build, deploy, and verify (phase 1)",
		RunE: func(cmd *cobra.Command, args []string) error {
			return fmt.Errorf("`hive ship` lands in phase 1 (drivers: vercel, static) — run `hive check` in the meantime")
		},
	}
}
