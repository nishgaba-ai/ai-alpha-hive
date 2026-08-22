package deploy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"

	"github.com/nishgaba-ai/ai-alpha-hive/internal/config"
)

// DropletDriver deploys to any VPS provisioned by scripts/provision-droplet.sh
// (docker + nginx + certbot). Not DigitalOcean-specific — plain ssh + docker.
//
// Configuration (portability contract — env only):
//
//	DROPLET_HOST      required — IP or hostname of the target
//	DROPLET_SSH_USER  optional — default root
//	DROPLET_APP_ROOT  optional — default /opt/hive-apps
//	CERTBOT_EMAIL     optional — enables TLS issuance when the app declares a domain
//
// Flow: tar-stream the project (deps excluded) to a timestamped release dir →
// docker build + run on the box → nginx vhost (declared domain, or instant
// <slug>.<ip>.sslip.io preview) → TLS via certbot when domain+email present →
// atomic `current` symlink flip → old releases pruned. File transfer is tar
// over ssh, so Windows works out of the box (no rsync dependency).
type DropletDriver struct{}

func (d *DropletDriver) Name() string { return "droplet" }

func sshTarget() string {
	user := os.Getenv("DROPLET_SSH_USER")
	if user == "" {
		user = "root"
	}
	return user + "@" + os.Getenv("DROPLET_HOST")
}

func sshArgs(extra ...string) []string {
	return append([]string{"-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", sshTarget()}, extra...)
}

func (d *DropletDriver) Preflight() error {
	if os.Getenv("DROPLET_HOST") == "" {
		return errors.New("DROPLET_HOST is not set — point it at a box provisioned with scripts/provision-droplet.sh (see .env.example)")
	}
	if _, err := exec.LookPath("ssh"); err != nil {
		return errors.New("ssh client not found on PATH")
	}
	out, err := exec.Command("ssh", sshArgs("docker --version && test -d "+appRoot())...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("cannot reach %s (key auth + provisioning required): %s", os.Getenv("DROPLET_HOST"), strings.TrimSpace(string(out)))
	}
	return nil
}

func appRoot() string {
	if r := os.Getenv("DROPLET_APP_ROOT"); r != "" {
		return r
	}
	return "/opt/hive-apps"
}

var (
	slugRe   = regexp.MustCompile(`^[a-z0-9-]+$`)
	domainRe = regexp.MustCompile(`^[a-zA-Z0-9.-]+$`)
)

func (d *DropletDriver) Deploy(ctx context.Context, dir string, opts Options) (string, error) {
	cfg, err := config.Load(dir)
	if err != nil {
		return "", fmt.Errorf("droplet driver needs %s (run `hive init`): %w", config.FileName, err)
	}
	slug := slugify(cfg.Site.Name)
	if !slugRe.MatchString(slug) {
		return "", fmt.Errorf("cannot derive a safe app slug from site name %q", cfg.Site.Name)
	}
	domain := cfg.Site.Domain
	if domain != "" && !domainRe.MatchString(domain) {
		return "", fmt.Errorf("invalid domain %q in %s", domain, config.FileName)
	}
	ts := opts.ReleaseID
	if ts == "" {
		return "", errors.New("missing release id")
	}

	release := fmt.Sprintf("%s/%s/releases/%s", appRoot(), slug, ts)

	// 1. Stream the source tree to the release dir (tar over ssh — no rsync).
	if err := d.upload(ctx, dir, release); err != nil {
		return "", err
	}

	// 2. Build, run, wire nginx, flip the symlink — one remote script.
	script := remoteDeployScript
	cmd := exec.CommandContext(ctx, "ssh", sshArgs("bash -s --", appRoot(), slug, ts,
		"'"+domain+"'", "'"+os.Getenv("CERTBOT_EMAIL")+"'", os.Getenv("DROPLET_HOST"))...)
	cmd.Stdin = strings.NewReader(script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("remote deploy failed:\n%s", lastLines(string(out), 25))
	}
	for _, line := range strings.Split(string(out), "\n") {
		if u, ok := strings.CutPrefix(strings.TrimSpace(line), "HIVE_URL="); ok {
			return u, nil
		}
	}
	return "", fmt.Errorf("remote deploy produced no URL:\n%s", lastLines(string(out), 10))
}

func (d *DropletDriver) upload(ctx context.Context, dir, release string) error {
	// .env.deploy is the ONE env file that ships — it holds the app's own
	// runtime config (injected via --env-file). Local/dev env files never do.
	tarCmd := exec.CommandContext(ctx, "tar", "czf", "-",
		"--exclude=node_modules", "--exclude=.next", "--exclude=.git",
		"--exclude=.hive", "--exclude=.env", "--exclude=.env.local",
		"--exclude=.env.development", "--exclude=.env.production",
		"--exclude=.env.test", "--exclude=.vercel",
		"-C", dir, ".")
	sshCmd := exec.CommandContext(ctx, "ssh", sshArgs("mkdir -p "+release+" && tar xzf - -C "+release)...)

	pipe, err := tarCmd.StdoutPipe()
	if err != nil {
		return err
	}
	sshCmd.Stdin = pipe
	var sshOut strings.Builder
	sshCmd.Stdout = &sshOut
	sshCmd.Stderr = &sshOut

	if err := tarCmd.Start(); err != nil {
		return fmt.Errorf("tar: %w", err)
	}
	if err := sshCmd.Start(); err != nil {
		return fmt.Errorf("ssh: %w", err)
	}
	tarErr := tarCmd.Wait()
	io.Copy(io.Discard, pipe) //nolint:errcheck // drain if ssh exited first
	sshErr := sshCmd.Wait()
	if tarErr != nil {
		return fmt.Errorf("tar failed: %w", tarErr)
	}
	if sshErr != nil {
		return fmt.Errorf("upload failed: %s", lastLines(sshOut.String(), 8))
	}
	return nil
}

func slugify(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = strings.ReplaceAll(s, " ", "-")
	s = regexp.MustCompile(`[^a-z0-9-]+`).ReplaceAllString(s, "")
	return strings.Trim(s, "-")
}

// remoteDeployScript runs on the droplet. Args:
//
//	$1 app root   $2 slug   $3 release ts   $4 domain (may be '')
//	$5 certbot email (may be '')   $6 host (for sslip.io preview URLs)
const remoteDeployScript = `
set -eu
APP_ROOT=$1; SLUG=$2; TS=$3; DOMAIN=${4#\'}; DOMAIN=${DOMAIN%\'}; EMAIL=${5#\'}; EMAIL=${EMAIL%\'}; HOST=$6
APP="$APP_ROOT/$SLUG"; REL="$APP/releases/$TS"
cd "$REL"

# stable per-app port, allocated once
if [ -f "$APP/PORT" ]; then PORT=$(cat "$APP/PORT"); else
  USED=$(cat "$APP_ROOT"/*/PORT 2>/dev/null || true)
  PORT=3001; while echo "$USED" | grep -qx "$PORT"; do PORT=$((PORT+1)); done
  echo "$PORT" > "$APP/PORT"
fi

# public URL decided before start so the app can know its own address.
# The sslip preview name stays in server_name even with a domain, so the
# app remains reachable while DNS cuts over.
SSLIP="$SLUG.$HOST.sslip.io"
WWW=""
if [ -n "$DOMAIN" ]; then
  PUBLIC_URL="https://$DOMAIN"
  case "$DOMAIN" in www.*) ;; *) WWW="www.$DOMAIN" ;; esac
  SERVER_NAME="$DOMAIN $WWW $SSLIP"
else SERVER_NAME="$SSLIP"; PUBLIC_URL="http://$SSLIP"; fi

# default Dockerfile for npm apps that don't ship their own
if [ ! -f Dockerfile ]; then
cat > Dockerfile <<'DF'
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY . .
ENV NODE_ENV=production
RUN npm run build
EXPOSE 3000
CMD ["npm","start"]
DF
fi

echo "building image hive-$SLUG:$TS ..."
docker build -q -t "hive-$SLUG:$TS" .
docker rm -f "hive-$SLUG" >/dev/null 2>&1 || true
ENVFILE=""
[ -f "$REL/.env.deploy" ] && ENVFILE="--env-file $REL/.env.deploy" && chmod 600 "$REL/.env.deploy"
docker run -d --name "hive-$SLUG" --restart unless-stopped $ENVFILE \
  -p "127.0.0.1:$PORT:3000" -e "SITE_URL=$PUBLIC_URL" "hive-$SLUG:$TS" >/dev/null

echo "waiting for app on :$PORT ..."
ok=""
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT"; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || { echo "app did not become healthy"; docker logs --tail 30 "hive-$SLUG"; exit 1; }

cat > "/etc/nginx/sites-enabled/hive-$SLUG.conf" <<CONF
server {
    listen 80;
    server_name $SERVER_NAME;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
CONF
nginx -t >/dev/null && systemctl reload nginx

if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
  # apex + www together; if www DNS isn't ready yet, fall back to apex only
  if [ -n "$WWW" ] && certbot --nginx -d "$DOMAIN" -d "$WWW" -m "$EMAIL" --agree-tos -n --redirect >/tmp/certbot.log 2>&1; then
    echo "tls: $DOMAIN + $WWW"
  elif certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos -n --redirect >/tmp/certbot.log 2>&1; then
    echo "tls: $DOMAIN (www pending DNS)"
  else
    echo "certbot failed (DNS not pointed yet?) — serving HTTP until it is"; tail -5 /tmp/certbot.log
  fi
fi

ln -sfn "$REL" "$APP/current"
ls -dt "$APP"/releases/* | tail -n +4 | xargs rm -rf 2>/dev/null || true
docker image prune -f >/dev/null 2>&1 || true

echo "HIVE_URL=$PUBLIC_URL"
`
