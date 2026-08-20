package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/nishgaba-ai/ai-alpha-hive/internal/deploy"
	"github.com/nishgaba-ai/ai-alpha-hive/internal/envfile"
	"github.com/nishgaba-ai/ai-alpha-hive/internal/gates"
	"github.com/spf13/cobra"
)

// releaseRecord is written to .hive/releases/ after every ship.
type releaseRecord struct {
	Timestamp time.Time      `json:"timestamp"`
	Env       string         `json:"env"`
	Driver    string         `json:"driver"`
	URL       string         `json:"url"`
	Verified  bool           `json:"verified"`
	Note      string         `json:"note,omitempty"`
	Gates     []gates.Result `json:"gates"`
}

func newShipCmd() *cobra.Command {
	var env, driverName string
	cmd := &cobra.Command{
		Use:   "ship",
		Short: "Run gates, deploy, verify — refuses on any blocking gate failure",
		RunE: func(cmd *cobra.Command, args []string) error {
			out := cmd.OutOrStdout()
			dir, err := os.Getwd()
			if err != nil {
				return err
			}
			if env != "preview" && env != "prod" {
				return fmt.Errorf("--env must be preview or prod")
			}
			if err := envfile.Load(dir); err != nil {
				return err
			}

			driver, ok := deploy.ByName(driverName)
			if !ok {
				return fmt.Errorf("unknown driver %q (available: vercel)", driverName)
			}
			if err := driver.Preflight(); err != nil {
				return err
			}

			// 1. Gates — the whole point. No pass, no deploy.
			fmt.Fprintln(out, "running gates…")
			results, err := gates.RunAll(cmd.Context(), dir)
			if err != nil {
				return err
			}
			for _, r := range results {
				status := "pass"
				if r.Skipped {
					status = "skip"
				} else if !r.Passed {
					status = "FAIL"
				}
				fmt.Fprintf(out, "  %-4s %s\n", status, r.Gate)
			}
			if gates.Blocked(results) {
				return fmt.Errorf("blocking gate failed — fix findings (`hive check --json`) and ship again")
			}

			// 2. Deploy.
			fmt.Fprintf(out, "deploying via %s (%s)…\n", driver.Name(), env)
			url, err := driver.Deploy(cmd.Context(), dir, deploy.Options{Prod: env == "prod"})
			if err != nil {
				return err
			}

			// 3. Verify the deployment actually responds.
			verified, note := verifyURL(cmd.Context(), url)

			// 4. Record the release.
			rec := releaseRecord{
				Timestamp: time.Now().UTC(), Env: env, Driver: driver.Name(),
				URL: url, Verified: verified, Note: note, Gates: results,
			}
			if err := writeRelease(dir, rec); err != nil {
				fmt.Fprintf(out, "warning: could not write release record: %v\n", err)
			}

			fmt.Fprintf(out, "\nshipped: %s\n", url)
			if note != "" {
				fmt.Fprintln(out, note)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&env, "env", "preview", "preview or prod")
	cmd.Flags().StringVar(&driverName, "driver", "vercel", "deploy driver")
	return cmd
}

// verifyURL polls the deployed URL until it responds. Access protection
// (Vercel SSO: 401/403, or a redirect off the deployment host to a login
// page) counts as reachable but is reported so nobody mistakes a gated
// preview for a public site.
func verifyURL(ctx context.Context, url string) (bool, string) {
	const protectedNote = "note: deployment is reachable but access-protected (Vercel SSO) — attach a domain or disable deployment protection for public access"
	client := &http.Client{Timeout: 15 * time.Second}
	for attempt := 0; attempt < 5; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return false, "verify: " + err.Error()
		}
		resp, err := client.Do(req)
		if err == nil {
			finalHost := resp.Request.URL.Host
			resp.Body.Close()
			switch {
			case resp.StatusCode < 400 && finalHost != req.URL.Host:
				return true, protectedNote // bounced to an auth host
			case resp.StatusCode < 400:
				return true, ""
			case resp.StatusCode == 401 || resp.StatusCode == 403:
				return true, protectedNote
			}
		}
		select {
		case <-ctx.Done():
			return false, "verify: cancelled"
		case <-time.After(4 * time.Second):
		}
	}
	return false, "verify: deployment did not respond successfully after 5 attempts"
}

func writeRelease(dir string, rec releaseRecord) error {
	relDir := filepath.Join(dir, ".hive", "releases")
	if err := os.MkdirAll(relDir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return err
	}
	name := rec.Timestamp.Format("20060102-150405") + "-" + rec.Env + ".json"
	return os.WriteFile(filepath.Join(relDir, name), b, 0o644)
}
