#!/usr/bin/env bash
# Pre-download the faster-whisper "base" model into desktop/build/whisper-base/
# so the PyInstaller spec can bundle it into the .app/.msi (no first-run
# network download for the user).
#
# Idempotent — skips if model.bin already exists.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$DESKTOP_DIR")"
BACKEND_DIR="$REPO_ROOT/backend"
OUT="$DESKTOP_DIR/build/whisper-base"
TMP_CACHE="$DESKTOP_DIR/build/whisper-fetch-cache"

if [[ -f "$OUT/model.bin" ]]; then
  echo "Whisper 'base' model already present at $OUT — skipping."
  exit 0
fi

mkdir -p "$OUT" "$TMP_CACHE"

echo "Downloading faster-whisper 'base' model (first run only, ~75 MB)…"
(
  cd "$BACKEND_DIR"
  uv run python - <<PY
import shutil
from pathlib import Path

from faster_whisper import WhisperModel

cache = Path("$TMP_CACHE")
cache.mkdir(parents=True, exist_ok=True)

# Triggers the actual download into a HuggingFace-cache layout under `cache`.
m = WhisperModel("base", device="cpu", compute_type="int8", download_root=str(cache))
del m  # release file handles before copying

snapshot_root = cache / "models--Systran--faster-whisper-base" / "snapshots"
if not snapshot_root.exists():
    raise SystemExit(f"Expected snapshot dir at {snapshot_root}, not found")

snapshots = sorted(snapshot_root.iterdir())
if not snapshots:
    raise SystemExit("No snapshots downloaded")
snapshot = snapshots[-1]  # any of them works; pick latest

out = Path("$OUT")
for src in snapshot.iterdir():
    dst = out / src.name
    if src.is_symlink():
        # snapshot/ has symlinks pointing into blobs/ — resolve and copy real bytes.
        shutil.copy2(src.resolve(), dst)
    else:
        shutil.copy2(src, dst)
print(f"Bundled-model files at {out}: {sorted(p.name for p in out.iterdir())}")
PY
)

echo "Done. Bundled model at: $OUT"
ls -lh "$OUT"
