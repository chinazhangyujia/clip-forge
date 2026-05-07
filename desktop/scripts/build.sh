#!/usr/bin/env bash
# End-to-end desktop build:
#   1. fetch ffmpeg/ffprobe statics for this platform
#   2. PyInstaller-bundle the FastAPI backend
#   3. Next.js static export of the web UI
#   4. stage native binaries into src-tauri/binaries/
#   5. cargo tauri build (produces .app + .dmg on macOS, .msi on Windows)
#
# Required env vars (set in the build environment):
#   CLIPFORGE_DEEPSEEK_API_KEY    — baked into the Tauri binary at compile time
#   CLIPFORGE_ANTHROPIC_API_KEY   — optional, for the claude provider
#   CLIPFORGE_LLM_PROVIDER        — defaults to "deepseek"
#   CLIPFORGE_WHISPER_MODEL       — defaults to "base"
#
# Run from repo root or anywhere — paths are resolved from the script location.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$DESKTOP_DIR")"
BACKEND_DIR="$REPO_ROOT/backend"
WEB_DIR="$REPO_ROOT/web"
SRC_TAURI="$DESKTOP_DIR/src-tauri"
BUILD_DIR="$DESKTOP_DIR/build"

case "$(uname -s)" in
  Darwin*) PLATFORM=mac ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM=win ;;
  *) echo "Unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

echo "▶ Build platform: $PLATFORM"

# --- 1. fetch ffmpeg statics --------------------------------------------------
echo "▶ Step 1/6: fetch ffmpeg/ffprobe"
"$SCRIPT_DIR/fetch-ffmpeg.sh"

# --- 1b. pre-download whisper "base" model ----------------------------------
echo "▶ Step 2/6: fetch whisper base model"
"$SCRIPT_DIR/fetch-whisper.sh"

# --- 2. PyInstaller backend bundle -------------------------------------------
echo "▶ Step 3/6: PyInstaller backend bundle"
(
  cd "$BACKEND_DIR"
  uv run pyinstaller "$SCRIPT_DIR/backend.spec" \
    --workpath "$BUILD_DIR/backend-work" \
    --distpath "$BUILD_DIR/backend-dist" \
    --noconfirm
)

# --- 3. Next.js static export -------------------------------------------------
echo "▶ Step 4/6: Next.js static export"
(
  cd "$WEB_DIR"
  if [[ ! -d node_modules ]]; then
    npm install
  fi
  npm run build
)

# --- 4. stage native binaries into src-tauri/binaries/ -----------------------
echo "▶ Step 5/6: stage binaries"
BINARIES_DIR="$SRC_TAURI/binaries"
rm -rf "$BINARIES_DIR"
mkdir -p "$BINARIES_DIR"

# Backend bundle (folder, not single file).
cp -R "$BUILD_DIR/backend-dist/clipforge-backend" "$BINARIES_DIR/clipforge-backend"

# ffmpeg/ffprobe — Tauri picks up everything under binaries/ as resources.
mkdir -p "$BINARIES_DIR/ffmpeg"
if [[ "$PLATFORM" == "mac" ]]; then
  cp "$DESKTOP_DIR/resources/mac/ffmpeg" "$BINARIES_DIR/ffmpeg/ffmpeg"
  cp "$DESKTOP_DIR/resources/mac/ffprobe" "$BINARIES_DIR/ffmpeg/ffprobe"
  chmod +x "$BINARIES_DIR/ffmpeg/ffmpeg" "$BINARIES_DIR/ffmpeg/ffprobe"
else
  cp "$DESKTOP_DIR/resources/win/ffmpeg.exe" "$BINARIES_DIR/ffmpeg/ffmpeg.exe"
  cp "$DESKTOP_DIR/resources/win/ffprobe.exe" "$BINARIES_DIR/ffmpeg/ffprobe.exe"
fi

# --- 5. cargo tauri build -----------------------------------------------------
echo "▶ Step 6/6: cargo tauri build"
export PATH="$HOME/.cargo/bin:$PATH"

# Bake API keys into the Rust binary at compile time. The shell reads these
# via option_env! and passes them to the backend sidecar as env vars.
export CLIPFORGE_DEEPSEEK_API_KEY="${CLIPFORGE_DEEPSEEK_API_KEY:-}"
export CLIPFORGE_ANTHROPIC_API_KEY="${CLIPFORGE_ANTHROPIC_API_KEY:-}"
export CLIPFORGE_LLM_PROVIDER="${CLIPFORGE_LLM_PROVIDER:-deepseek}"
export CLIPFORGE_WHISPER_MODEL="${CLIPFORGE_WHISPER_MODEL:-base}"

if [[ -z "$CLIPFORGE_DEEPSEEK_API_KEY" && "$CLIPFORGE_LLM_PROVIDER" == "deepseek" ]]; then
  echo "WARNING: CLIPFORGE_DEEPSEEK_API_KEY is empty; the bundled app will fail" >&2
  echo "  on the cut stage. Re-export and re-run if you want a working build." >&2
fi

(
  cd "$SRC_TAURI"
  # Tauri's macOS bundle step has two phases: build the .app, then call the
  # bundled `bundle_dmg.sh` to produce the .dmg. The .app phase is reliable;
  # bundle_dmg.sh has been flaky on macOS 26 (AppleScript / hdiutil
  # interactions). We tolerate a non-zero exit here and rebuild the DMG from
  # the .app directly with `hdiutil` as a fallback below.
  cargo tauri build || true
)

if [[ "$PLATFORM" == "mac" ]]; then
  APP="$SRC_TAURI/target/release/bundle/macos/ClipForge.app"
  if [[ ! -d "$APP" ]]; then
    echo "✗ ClipForge.app was not produced. Tauri build failed earlier." >&2
    exit 1
  fi
  DMG="$SRC_TAURI/target/release/bundle/dmg/ClipForge_0.1.0_aarch64.dmg"
  if [[ ! -f "$DMG" ]]; then
    echo "▶ DMG missing; building plain UDZO DMG via hdiutil"
    mkdir -p "$(dirname "$DMG")"
    rm -f "$SRC_TAURI/target/release/bundle/macos/rw.*.dmg"
    hdiutil create -volname ClipForge -srcfolder "$APP" -ov -format UDZO "$DMG"
  fi
  echo "✓ Build complete."
  echo "  $APP"
  echo "  $DMG"
else
  MSI=$(find "$SRC_TAURI/target/release/bundle/msi" -name "*.msi" 2>/dev/null | head -1)
  if [[ -z "$MSI" ]]; then
    echo "✗ No .msi produced. Tauri build failed." >&2
    exit 1
  fi
  echo "✓ Build complete."
  echo "  $MSI"
fi
