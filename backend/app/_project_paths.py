"""Filesystem layout for a project's files (local-desktop mode).

Each ProjectRow records the parent library directory it was created in
(`row.library`, may be None for legacy projects → workspace_dir). All files
for project p live together at::

    <library>/<p.id>/source.<ext>      original uploaded video
    <library>/<p.id>/audio.wav         extracted audio for whisper
    <library>/<p.id>/transcript.json   whisper segments
    <library>/<p.id>/cuts.json         LLM-proposed clip boundaries
    <library>/<p.id>/clips/<cid>.mp4   rendered clip files

Helpers either take a full ProjectRow (post-insert) or the raw (library, id)
tuple (for the create-project flow which writes the source file before the
row is inserted).
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from .config import settings
from .datastore.base import ProjectRow

# Characters illegal in filenames on Windows (the union of NTFS + FAT32 reserved
# chars, which is the strictest target). Posix is fine with everything except /
# and the NUL byte. Stripping this set makes the same sanitized filename work
# on either platform without surprising mojibake or rename failures.
_FILENAME_ILLEGAL = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def project_dir(library: str | None, project_id: str) -> Path:
    """Folder holding everything for one project. Creates it lazily."""
    root = Path(library) if library else settings.workspace_dir
    p = root / project_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def source_path_raw(library: str | None, project_id: str, ext: str) -> Path:
    if not ext.startswith("."):
        ext = "." + ext if ext else ".mp4"
    return project_dir(library, project_id) / f"source{ext}"


def source_path(project: ProjectRow) -> Path:
    ext = Path(project.source_filename or "source.mp4").suffix.lower() or ".mp4"
    return source_path_raw(project.library, project.id, ext)


def audio_path(project: ProjectRow) -> Path:
    return project_dir(project.library, project.id) / "audio.wav"


def transcript_path(project: ProjectRow) -> Path:
    return project_dir(project.library, project.id) / "transcript.json"


def cuts_path(project: ProjectRow) -> Path:
    return project_dir(project.library, project.id) / "cuts.json"


def speech_intervals_path(project: ProjectRow) -> Path:
    return project_dir(project.library, project.id) / "speech_intervals.json"


def clip_filename(title: str, clip_id: str) -> str:
    """Filesystem-safe filename derived from the clip's display title. We use
    the title (not the internal clip_id) so the on-disk mp4 is recognisable
    when the user opens their project folder in Finder / Explorer — a
    Mandarin clip ends up as "AI 时代…mp4", not "p_e54b803b-c59.mp4".

    Falls back to the clip_id if the title contains nothing usable after
    stripping illegal filename characters. The extension is fixed: clips are
    always mp4."""
    safe = _FILENAME_ILLEGAL.sub("", title or "").strip()
    return f"{safe or clip_id}.mp4"


def clips_dir(project: ProjectRow) -> Path:
    p = project_dir(project.library, project.id) / "clips"
    p.mkdir(parents=True, exist_ok=True)
    return p


def clip_path(project: ProjectRow, clip_id: str, title: str | None = None) -> Path:
    """Path the renderer writes the clip's mp4 to. Title-derived so it's
    recognisable in the file manager; falls back to clip_id when no title is
    available (legacy callers / safety net)."""
    return clips_dir(project) / clip_filename(title or clip_id, clip_id)


def delete_project_dir(library: str | None, project_id: str) -> None:
    root = Path(library) if library else settings.workspace_dir
    target = root / project_id
    shutil.rmtree(target, ignore_errors=True)
