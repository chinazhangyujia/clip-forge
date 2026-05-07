#!/usr/bin/env bash
# Pre-download the faster-whisper "base" model into desktop/build/whisper-base/
# so the PyInstaller spec can bundle it into the .app/.msi (no first-run
# network download for the user).
#
# All real work lives in the sibling `_fetch_whisper.py` — keeping the Python
# in its own file avoids heredoc + Git-CRLF interactions on Windows runners.
#
# Idempotent: skips if model.bin already exists at the target.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$DESKTOP_DIR")"
BACKEND_DIR="$REPO_ROOT/backend"
OUT="$DESKTOP_DIR/build/whisper-base"

if [[ -f "$OUT/model.bin" ]]; then
  echo "Whisper 'base' model already present at $OUT — skipping."
  exit 0
fi

mkdir -p "$OUT"

echo "Downloading faster-whisper 'base' model (~140 MB)…"
export OUT_DIR="$OUT"
(
  cd "$BACKEND_DIR"
  uv run python "$SCRIPT_DIR/_fetch_whisper.py"
)

echo "Done. Bundled model at: $OUT"
ls -lh "$OUT" 2>/dev/null || true
