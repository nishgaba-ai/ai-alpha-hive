package deploy

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
)

// VercelDriver deploys via the Vercel CLI (invoked through npx so no global
// install is required). Configuration comes exclusively from the environment,
// per the portability contract:
//
//	VERCEL_TOKEN    required — vercel.com/account/settings/tokens
//	VERCEL_TEAM_ID  optional — deploy into a team scope
type VercelDriver struct{}

func (d *VercelDriver) Name() string { return "vercel" }

func (d *VercelDriver) Preflight() error {
	if os.Getenv("VERCEL_TOKEN") == "" {
		return errors.New("VERCEL_TOKEN is not set — create one at vercel.com/account/settings/tokens and put it in .env (see .env.example)")
	}
	return nil
}

func (d *VercelDriver) Deploy(ctx context.Context, dir string, opts Options) (string, error) {
	token := os.Getenv("VERCEL_TOKEN")
	args := []string{"--yes", "vercel", "deploy", "--yes", "--token", token}
	if opts.Prod {
		args = append(args, "--prod")
	}
	if scope := os.Getenv("VERCEL_TEAM_ID"); scope != "" {
		args = append(args, "--scope", scope)
	}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "cmd", append([]string{"/C", "npx"}, args...)...)
	} else {
		cmd = exec.CommandContext(ctx, "npx", args...)
	}
	cmd.Dir = dir
	cmd.Env = os.Environ()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// stderr may echo argv on some failures — scrub the token before reporting.
		msg := strings.ReplaceAll(lastLines(stderr.String(), 12), token, "***")
		return "", fmt.Errorf("vercel deploy failed: %s", msg)
	}
	url := deploymentURL(stdout.String() + "\n" + stderr.String())
	if url == "" {
		return "", fmt.Errorf("vercel deploy produced no URL; output: %s", lastLines(stdout.String(), 6))
	}
	return url, nil
}

var urlRe = regexp.MustCompile(`https://[^\s"',]+`)

// deploymentURL extracts the deployment URL from CLI output, which varies by
// vercel CLI version (plain lines vs JSON summaries). Deployment URLs live on
// *.vercel.app; vercel.com URLs are the inspector, never the deployment.
func deploymentURL(out string) string {
	urls := urlRe.FindAllString(out, -1)
	for i := len(urls) - 1; i >= 0; i-- {
		if strings.Contains(urls[i], ".vercel.app") {
			return urls[i]
		}
	}
	for i := len(urls) - 1; i >= 0; i-- {
		if !strings.Contains(urls[i], "vercel.com") {
			return urls[i]
		}
	}
	return ""
}

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
