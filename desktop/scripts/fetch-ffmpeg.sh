#!/usr/bin/env bash
# Fetch static ffmpeg + ffprobe for the current platform into
# desktop/resources/<platform>/.
#
# Sources:
#   macOS arm64 → osxexperts.net (ffmpeg 8.1, Apple Silicon native)
#   Windows x86_64 → gyan.dev release-essentials (latest stable)
#
# Idempotent — skips download if the binaries already exist and run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
RES_DIR="$DESKTOP_DIR/resources"

case "$(uname -s)" in
  Darwin*)
    arch="$(uname -m)"
    if [[ "$arch" != "arm64" ]]; then
      echo "Only arm64 macOS is supported in this script (got $arch)." >&2
      echo "For Intel Macs, fetch x86_64 builds from evermeet.cx instead." >&2
      exit 1
    fi
    OUT="$RES_DIR/mac"
    mkdir -p "$OUT"
    if [[ -x "$OUT/ffmpeg" && -x "$OUT/ffprobe" ]]; then
      echo "ffmpeg and ffprobe already present in $OUT — skipping download."
      exit 0
    fi
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    echo "Downloading ffmpeg (arm64)…"
    curl -fL --http1.1 --retry 3 --retry-delay 2 \
      -o "$tmp/ffmpeg.zip" \
      "https://www.osxexperts.net/ffmpeg81arm.zip"
    echo "Downloading ffprobe (arm64)…"
    curl -fL --http1.1 --retry 3 --retry-delay 2 \
      -o "$tmp/ffprobe.zip" \
      "https://www.osxexperts.net/ffprobe81arm.zip"
    (cd "$tmp" && unzip -q ffmpeg.zip && unzip -q ffprobe.zip)
    mv "$tmp/ffmpeg" "$OUT/ffmpeg"
    mv "$tmp/ffprobe" "$OUT/ffprobe"
    chmod +x "$OUT/ffmpeg" "$OUT/ffprobe"
    # Strip the Gatekeeper quarantine attribute so unsigned execs run.
    xattr -dr com.apple.quarantine "$OUT/ffmpeg" "$OUT/ffprobe" 2>/dev/null || true
    echo "Installed: $OUT/ffmpeg $OUT/ffprobe"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    OUT="$RES_DIR/win"
    mkdir -p "$OUT"
    if [[ -x "$OUT/ffmpeg.exe" && -x "$OUT/ffprobe.exe" ]]; then
      echo "ffmpeg.exe and ffprobe.exe already present — skipping."
      exit 0
    fi
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    echo "Downloading gyan.dev ffmpeg release-essentials…"
    curl -fL --retry 3 -o "$tmp/ffmpeg.zip" \
      "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    (cd "$tmp" && unzip -q ffmpeg.zip)
    # Layout: ffmpeg-N.N-essentials_build/bin/{ffmpeg,ffprobe}.exe
    found_dir="$(find "$tmp" -type d -name 'ffmpeg-*-essentials_build' | head -1)"
    cp "$found_dir/bin/ffmpeg.exe" "$OUT/ffmpeg.exe"
    cp "$found_dir/bin/ffprobe.exe" "$OUT/ffprobe.exe"
    echo "Installed: $OUT/ffmpeg.exe $OUT/ffprobe.exe"
    ;;
  *)
    echo "Unsupported OS: $(uname -s)" >&2
    exit 1
    ;;
esac
