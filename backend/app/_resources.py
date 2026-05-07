"""Locate bundled native binaries (ffmpeg, ffprobe).

Resolution order:
  1. CLIPFORGE_FFMPEG_DIR env var (set by the Tauri shell at spawn time).
  2. PyInstaller bundle directory (sys._MEIPASS for --onefile, the executable's
     parent for --onedir).
  3. Bare name on PATH (dev mode).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _bundle_dir() -> Path | None:
    override = os.getenv("CLIPFORGE_FFMPEG_DIR", "")
    if override:
        return Path(override)
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return None


def ffmpeg_bin(name: str) -> str:
    """Resolve "ffmpeg" or "ffprobe" to a runnable path."""
    bd = _bundle_dir()
    if bd is not None:
        exe = name + (".exe" if sys.platform == "win32" else "")
        candidate = bd / exe
        if candidate.exists():
            return str(candidate)
    return name


def bundled_whisper_model_dir() -> Path | None:
    """Locate the pre-downloaded faster-whisper model bundled with the app.

    PyInstaller's `datas` ship the snapshot files under `whisper-base/`. They
    land in `sys._MEIPASS` (PyInstaller's bootloader sets this for both
    --onefile and --onedir). For --onedir, that resolves to `_internal/`
    next to the executable; for dev runs, it's not set and we return None
    (caller falls back to lazy download).
    """
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        candidate = Path(meipass) / "whisper-base"
        if (candidate / "model.bin").exists():
            return candidate
    if getattr(sys, "frozen", False):
        # Some PyInstaller --onedir builds only set _MEIPASS to the parent;
        # check the canonical _internal/ subdir as a fallback.
        candidate = Path(sys.executable).parent / "_internal" / "whisper-base"
        if (candidate / "model.bin").exists():
            return candidate
    return None
