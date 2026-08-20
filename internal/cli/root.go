// Package cli wires the hive command tree.
package cli

import "github.com/spf13/cobra"

// Version is stamped by goreleaser at release time.
var Version = "0.0.1-dev"

// Root returns the top-level hive command.
func Root() *cobra.Command {
	root := &cobra.Command{
		Use:           "hive",
		Short:         "AI Alpha Hive — deterministic delivery engine for AI-built software",
		Long:          "hive scaffolds, checks, and ships AI-built sites and services.\nThe AI proposes, the gates dispose: nothing deploys unless every gate passes.",
		Version:       Version,
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	root.AddCommand(
		newInitCmd(),
		newCheckCmd(),
		newDoctorCmd(),
		newNewCmd(),
		newShipCmd(),
	)
	return root
}
