#!/usr/bin/env sh
# Install the latest hive release binary (linux/macos).
# Usage: curl -fsSL https://raw.githubusercontent.com/nishgaba-ai/ai-alpha-hive/main/scripts/install.sh | sh
set -eu

REPO="nishgaba-ai/ai-alpha-hive"
INSTALL_DIR="${HIVE_INSTALL_DIR:-/usr/local/bin}"

os=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$os" in
  linux|darwin) ;;
  *) echo "unsupported OS: $os (on Windows, download the zip from GitHub releases)"; exit 1 ;;
esac

arch=$(uname -m)
case "$arch" in
  x86_64|amd64) arch="amd64" ;;
  aarch64|arm64) arch="arm64" ;;
  *) echo "unsupported arch: $arch"; exit 1 ;;
esac

tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
[ -n "$tag" ] || { echo "could not resolve latest release"; exit 1; }
version=${tag#v}

url="https://github.com/$REPO/releases/download/$tag/hive_${version}_${os}_${arch}.tar.gz"
echo "installing hive $tag ($os/$arch) to $INSTALL_DIR"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/hive.tar.gz"
tar -xzf "$tmp/hive.tar.gz" -C "$tmp"

if [ -w "$INSTALL_DIR" ]; then
  mv "$tmp/hive" "$INSTALL_DIR/hive"
else
  echo "$INSTALL_DIR is not writable — using sudo"
  sudo mv "$tmp/hive" "$INSTALL_DIR/hive"
fi

echo "installed: $("$INSTALL_DIR/hive" --version)"
