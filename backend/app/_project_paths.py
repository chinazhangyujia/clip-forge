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

import shutil
from pathlib import Path

from .config import settings
from .datastore.base import ProjectRow


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


def clip_path(project: ProjectRow, clip_id: str) -> Path:
    p = project_dir(project.library, project.id) / "clips" / f"{clip_id}.mp4"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def clip_variant_path(project: ProjectRow, clip_id: str, variant: str) -> Path:
    """Path for a non-original variant of a clip — the 9:16 vertical
    reframe lives at clips/{id}-reframe.mp4 alongside the original."""
    p = project_dir(project.library, project.id) / "clips" / f"{clip_id}-{variant}.mp4"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def delete_project_dir(library: str | None, project_id: str) -> None:
    root = Path(library) if library else settings.workspace_dir
    target = root / project_id
    shutil.rmtree(target, ignore_errors=True)
