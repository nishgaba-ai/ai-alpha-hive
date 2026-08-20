package cli

import (
	"fmt"
	"os"

	"github.com/nishgaba-ai/ai-alpha-hive/internal/config"
	"github.com/spf13/cobra"
)

func newInitCmd() *cobra.Command {
	var name, intent string
	cmd := &cobra.Command{
		Use:   "init",
		Short: "Adopt hive in the current directory (writes hive.yaml)",
		RunE: func(cmd *cobra.Command, args []string) error {
			dir, err := os.Getwd()
			if err != nil {
				return err
			}
			if config.Exists(dir) {
				return fmt.Errorf("%s already exists — edit it directly or use `hive intent` (phase 2)", config.FileName)
			}
			if name == "" {
				name = "my-site"
			}
			c := &config.Config{Site: config.Site{Name: name, Intent: intent}}
			if err := config.Save(dir, c); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "wrote %s — declare your intent there, then run `hive check`\n", config.FileName)
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "project name")
	cmd.Flags().StringVar(&intent, "intent", "", "one-line site intent (what should visitors do?)")
	return cmd
}
