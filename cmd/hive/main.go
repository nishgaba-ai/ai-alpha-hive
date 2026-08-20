// Command hive is the AI Alpha Hive engine CLI.
//
// The AI proposes, the engine disposes: hive owns structure, checks,
// deployment, and the dependency graph, so guarantees live in code —
// never in prompts.
package main

import (
	"fmt"
	"os"

	"github.com/nishgaba-ai/ai-alpha-hive/internal/cli"
)

func main() {
	if err := cli.Root().Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "hive:", err)
		os.Exit(1)
	}
}
