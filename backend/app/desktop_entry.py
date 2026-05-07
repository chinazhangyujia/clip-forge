"""Entrypoint for the desktop bundle.

The Tauri shell spawns this binary with `--data-dir` (the user-chosen project
directory) and optionally `--port`. We translate args to env vars before
importing the FastAPI app so config.Settings picks them up, then run uvicorn
in-process.

The chosen port is printed on stdout as `CLIPFORGE_PORT=<n>` BEFORE uvicorn
starts logging, so the shell can read it without grepping uvicorn's output.
"""

from __future__ import annotations

import argparse
import os
import socket
import sys
from pathlib import Path


def _pick_free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


def main() -> None:
    parser = argparse.ArgumentParser(prog="clipforge-backend")
    parser.add_argument(
        "--data-dir",
        required=True,
        type=Path,
        help="Directory for projects, transcripts, models, db.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="Port to listen on (0 = pick free port).",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--ffmpeg-dir",
        type=Path,
        default=None,
        help="Directory containing ffmpeg/ffprobe binaries.",
    )
    args = parser.parse_args()

    args.data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["CLIPFORGE_WORKSPACE_DIR"] = str(args.data_dir.resolve())
    if args.ffmpeg_dir is not None:
        os.environ["CLIPFORGE_FFMPEG_DIR"] = str(args.ffmpeg_dir.resolve())

    port = args.port or _pick_free_port(args.host)
    sys.stdout.write(f"CLIPFORGE_PORT={port}\n")
    sys.stdout.flush()

    import uvicorn

    # Absolute import so PyInstaller-frozen execution works (the entrypoint
    # script runs at top level there, with no parent package context).
    from app.main import app

    uvicorn.run(app, host=args.host, port=port, log_level="info")


if __name__ == "__main__":
    main()
