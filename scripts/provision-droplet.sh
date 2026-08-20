#!/usr/bin/env bash
# Provision a fresh Ubuntu 24.04 droplet/VPS as a hive deployment target.
# Idempotent — safe to re-run. Works on any provider, not just DigitalOcean.
#
# Usage: ssh root@<ip> bash < scripts/provision-droplet.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
# Fresh cloud images run cloud-init/unattended-upgrades on first boot, which
# holds the dpkg lock — make every apt call wait instead of dying.
APT="apt-get -o DPkg::Lock::Timeout=600"

echo "=== [1/7] base packages ==="
$APT update -q
$APT upgrade -yq
$APT install -yq ca-certificates curl gnupg ufw fail2ban nginx certbot \
  python3-certbot-nginx git rsync htop

echo "=== [2/7] swap (2G) ==="
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "=== [3/7] firewall ==="
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | head -10

echo "=== [4/7] fail2ban ==="
systemctl enable --now fail2ban

echo "=== [5/7] docker ==="
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker --version

echo "=== [6/7] hive app root + nginx isolation ==="
mkdir -p /opt/hive-apps
mkdir -p /opt/hive-backups
# Isolation: unmatched Host headers (incl. direct IP hits) are dropped, so
# apps are reachable ONLY via their own server_name — nothing is discoverable
# by scanning the IP, and co-hosted systems never leak through the default vhost.
rm -f /etc/nginx/sites-enabled/default
cat > /etc/nginx/sites-enabled/000-default-drop.conf <<'NGX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}
NGX
nginx -t >/dev/null && systemctl reload nginx

echo "=== [7/7] ssh hardening ==="
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
# Ubuntu 24.04 socket-activates ssh; config applies per-connection either way
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || systemctl try-restart ssh.socket 2>/dev/null || true

echo "=== provision complete ==="
echo "host: $(hostname) | docker: $(docker --version | cut -d, -f1) | nginx: $(nginx -v 2>&1)"
