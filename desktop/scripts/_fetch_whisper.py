"""Pre-download the faster-whisper "base" model into $OUT_DIR.

Cross-platform — uses huggingface_hub.snapshot_download with local_dir so
the files land as plain regular files (not the cache's symlink layout that
trips Windows up).

Invoked by `desktop/scripts/fetch-whisper.sh` with `OUT_DIR` exported. Kept
as a separate file (not a heredoc) so the Python source survives Git's CRLF
line-ending conversion on Windows runners.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ID = "Systran/faster-whisper-base"
REQUIRED = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")


def main() -> None:
    out = os.environ.get("OUT_DIR")
    if not out:
        print("OUT_DIR env var is required", file=sys.stderr)
        sys.exit(2)

    out_path = Path(out)
    out_path.mkdir(parents=True, exist_ok=True)

    if all((out_path / name).exists() for name in REQUIRED):
        print(f"All required model files already present in {out_path} — skipping.")
        return

    from huggingface_hub import snapshot_download

    # In huggingface_hub >= 0.17, passing local_dir writes regular files
    # directly (no symlinks-into-cache layout). Older versions accept
    # `local_dir_use_symlinks=False` to force the same behavior.
    kwargs: dict[str, object] = {"repo_id": REPO_ID, "local_dir": str(out_path)}
    try:
        snapshot_download(**kwargs, local_dir_use_symlinks=False)
    except TypeError:
        # Newer hf_hub removed the deprecated kwarg.
        snapshot_download(**kwargs)

    missing = [n for n in REQUIRED if not (out_path / n).exists()]
    if missing:
        print(
            f"Download finished but required files are missing: {missing}. "
            f"Files present: {sorted(p.name for p in out_path.iterdir())}",
            file=sys.stderr,
        )
        sys.exit(3)

    print(
        f"Bundled-model files at {out_path}: "
        f"{sorted(p.name for p in out_path.iterdir() if p.is_file())}"
    )


if __name__ == "__main__":
    main()
