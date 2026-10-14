#!/bin/sh
# Inspect this script before running. No sudo, global runtime, Git or shell-profile changes.
set -eu
umask 077
NODE_VERSION=24.21.0
OS=$(uname -s)
CPU=$(uname -m)
case "$CPU" in arm64|aarch64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) echo 'Unsupported CPU. See README.' >&2; exit 1 ;; esac
case "$OS-$ARCH" in
 Darwin-arm64) PLATFORM=darwin; HASH=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057 ;;
 Darwin-x64) PLATFORM=darwin; HASH=1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097 ;;
 Linux-x64) PLATFORM=linux; HASH=6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff ;;
 *) echo 'This OS/CPU is outside the initial installation matrix. See README.' >&2; exit 1 ;;
esac
for TOOL in curl tar; do command -v "$TOOL" >/dev/null 2>&1 || { echo "Install prerequisite $TOOL and retry." >&2; exit 1; }; done
if [ "$PLATFORM" = darwin ]; then
 ROOT=${SATURDAY_INSTALL_ROOT:-"$HOME/Library/Application Support/Saturday"}
 command -v shasum >/dev/null 2>&1 || { echo 'Missing shasum. See README.' >&2; exit 1; }
else
 case "${XDG_DATA_HOME:-}" in /*) DATA_BASE=$XDG_DATA_HOME ;; *) DATA_BASE="$HOME/.local/share" ;; esac
 ROOT=${SATURDAY_INSTALL_ROOT:-"$DATA_BASE/saturday"}
 command -v sha256sum >/dev/null 2>&1 || { echo 'Missing sha256sum. See README.' >&2; exit 1; }
fi
case "$ROOT" in /*) ;; *) echo 'SATURDAY_INSTALL_ROOT must be absolute.' >&2; exit 1 ;; esac
mkdir -p "$ROOT/runtime/downloads"
RUNTIME="node-v$NODE_VERSION-$PLATFORM-$ARCH"
ARCHIVE="$ROOT/runtime/downloads/$RUNTIME.tar.gz"
NODE="$ROOT/runtime/$RUNTIME/bin/node"
# Always check cached archive integrity before trusting/reusing the private runtime.
if [ ! -f "$ARCHIVE" ]; then
 echo 'Preparing the private Node runtime…' >&2
 curl --proto '=https' --tlsv1.2 -fL --retry 2 -o "$ARCHIVE.part" "https://nodejs.org/dist/v$NODE_VERSION/$RUNTIME.tar.gz"
 mv "$ARCHIVE.part" "$ARCHIVE"
fi
if [ "$PLATFORM" = darwin ]; then ACTUAL=$(shasum -a 256 "$ARCHIVE" | cut -d ' ' -f 1); else ACTUAL=$(sha256sum "$ARCHIVE" | cut -d ' ' -f 1); fi
if [ "$ACTUAL" != "$HASH" ]; then echo "Runtime checksum failed. Remove only $ARCHIVE and retry." >&2; exit 1; fi
if [ ! -x "$NODE" ]; then
 TMP=$(mktemp -d "$ROOT/runtime/extract-XXXXXX")
 trap 'rm -rf "$TMP"' EXIT HUP INT TERM
 tar -xzf "$ARCHIVE" -C "$TMP"
 if [ -e "$ROOT/runtime/$RUNTIME" ]; then echo 'Incomplete runtime exists. Inspect it before retrying.' >&2; exit 1; fi
 mv "$TMP/$RUNTIME" "$ROOT/runtime/$RUNTIME"
fi
"$NODE" -e 'if(process.versions.node!=="24.21.0")process.exit(1)'
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -f "$HERE/scripts/install.mjs" ]; then
 ENGINE="$HERE/scripts/install.mjs"
else
 # Resolve main once; execute only that pinned official installer, then verify its source tree in the shared engine.
 COMMIT=$("$NODE" --input-type=module -e 'const r=await fetch("https://api.github.com/repos/kennysantanu/saturday/commits/main",{headers:{"user-agent":"Saturday installer"},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`GitHub ${r.status}`);const j=await r.json();if(!/^[a-f0-9]{40}$/.test(j.sha))throw Error("Invalid commit");console.log(j.sha)')
 ENGINE="$ROOT/runtime/downloads/install-$COMMIT.mjs"
 curl --proto '=https' --tlsv1.2 -fL --retry 2 -o "$ENGINE.part" "https://raw.githubusercontent.com/kennysantanu/saturday/$COMMIT/scripts/install.mjs"
 mv "$ENGINE.part" "$ENGINE"
 set -- --bootstrap-commit "$COMMIT" "$@"
fi
"$NODE" "$ENGINE" --root "$ROOT" "$@"
