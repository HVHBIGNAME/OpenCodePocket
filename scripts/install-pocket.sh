#!/bin/sh
set -eu
base=${OCC_RELEASE_URL:-https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.2}
config=${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}
state=${OCC_STATE_DIR:-$config/occ-pocket}
installer=$state/installer
mkdir -p "$installer"
chmod 700 "$state" "$installer"
temporary=$(mktemp -d "$installer/download.XXXXXX")
trap 'rm -rf "$temporary"' EXIT HUP INT TERM

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}
download() {
  curl --fail --silent --show-error --location "$1" -o "$temporary/payload"
  [ "$(checksum "$temporary/payload")" = "$3" ] || { echo "Checksum mismatch: $1" >&2; exit 1; }
  mv "$temporary/payload" "$2"
}
node_path=$(command -v node || true)
if [ -z "$node_path" ] && [ -x "$state/runtime/bin/node" ]; then node_path=$state/runtime/bin/node; fi
if [ -n "$node_path" ] && ! "$node_path" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then node_path=; fi
if [ -z "$node_path" ]; then
  case $(uname -s) in Linux) os=linux;; Darwin) os=darwin;; *) echo 'Unsupported OS' >&2; exit 1;; esac
  case $(uname -m) in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo 'Unsupported CPU architecture' >&2; exit 1;; esac
  node_base=https://nodejs.org/dist/latest-v24.x
  curl --fail --silent --show-error --location "$node_base/SHASUMS256.txt" -o "$temporary/node-sums"
  file=$(awk -v suffix="-$os-$arch.tar.gz" 'index($2, suffix) && substr($2, length($2)-length(suffix)+1)==suffix {print $2; exit}' "$temporary/node-sums")
  [ -n "$file" ] || { echo 'Official Node.js archive not found' >&2; exit 1; }
  hash=$(awk -v file="$file" '$2==file {print $1}' "$temporary/node-sums")
  echo 'Downloading a private Node.js runtime...'
  download "$node_base/$file" "$temporary/node.tar.gz" "$hash"
  mkdir -p "$state/runtime"
  tar -xzf "$temporary/node.tar.gz" -C "$state/runtime" --strip-components=1
  node_path=$state/runtime/bin/node
fi
echo 'Downloading OpenCode Pocket...'
curl --fail --silent --show-error --location "$base/SHA256SUMS.txt" -o "$temporary/sums"
for item in 'occ-pocket-cli.mjs:cli.mjs' 'occ-pocket-plugin.mjs:plugin.js' 'occ-pocket-tui.mjs:tui.js'; do
  asset=${item%%:*}; destination=${item#*:}
  hash=$(awk -v file="$asset" '$2==file {print $1}' "$temporary/sums")
  [ -n "$hash" ] || { echo "Missing release checksum: $asset" >&2; exit 1; }
  download "$base/$asset" "$installer/$destination" "$hash"
done
"$node_path" "$installer/cli.mjs" install
echo 'Installed. Restart OpenCode, then type /pocket-qr.'
