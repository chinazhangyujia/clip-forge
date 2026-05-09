"""Pipeline stages: extract audio, transcribe, propose cuts, slice clips.

Each stage is callable from the worker. Stages are designed to be re-runnable —
they overwrite their output artifact rather than appending. All I/O goes
through the configured BlobStore so we get the same code path in dev (local
files) and prod (S3) once the prod store is wired up.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from . import _project_paths as pp
from ._resources import ffmpeg_bin
from .datastore import ProjectRow, get_datastore
from .providers import Cut, get_provider

log = logging.getLogger(__name__)


# ---------- ffprobe / ffmpeg helpers ----------


async def _run(*args: str) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    return (
        proc.returncode or 0,
        out.decode("utf-8", "replace"),
        err.decode("utf-8", "replace"),
    )


async def probe_duration_sec(source: Path) -> float:
    code, out, err = await _run(
        ffmpeg_bin("ffprobe"),
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(source),
    )
    if code != 0:
        size = source.stat().st_size if source.exists() else "missing"
        raise RuntimeError(
            f"ffprobe exit={code} for {source} (size={size}): "
            f"stderr={err.strip()!r} stdout={out.strip()!r}"
        )
    try:
        return float(out.strip())
    except ValueError as e:
        raise RuntimeError(
            f"ffprobe stdout not a number for {source}: "
            f"stdout={out.strip()!r} stderr={err.strip()!r}"
        ) from e


async def _get_project(project_id: str) -> ProjectRow:
    project = await get_datastore().get_project(project_id)
    if project is None:
        raise RuntimeError(f"Project {project_id} not found")
    return project


async def extract_audio(project_id: str) -> Path:
    project = await _get_project(project_id)
    src_path = pp.source_path(project)
    if not src_path.exists():
        raise RuntimeError("Source file not found")
    out_path = pp.audio_path(project)
    code, _, err = await _run(
        ffmpeg_bin("ffmpeg"),
        "-y",
        "-i",
        str(src_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(out_path),
    )
    if code != 0:
        raise RuntimeError(f"ffmpeg audio extraction failed: {err.strip()[-500:]}")
    return out_path


# ---------- transcribe ----------


_whisper_model = None


def _get_whisper_model():
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    from faster_whisper import WhisperModel

    from ._resources import bundled_whisper_model_dir
    from .config import settings

    # Prefer the model shipped inside the .app/.msi bundle when the user is on
    # the configured "base" model (the only one we currently bundle). Avoids
    # the first-transcribe network round trip and works fully offline.
    bundled = bundled_whisper_model_dir()
    if bundled is not None and settings.clipforge_whisper_model == "base":
        log.info("Loading bundled faster-whisper model from %s", bundled)
        _whisper_model = WhisperModel(
            str(bundled),
            device="cpu",
            compute_type="int8",
        )
        return _whisper_model

    download_root = settings.workspace_dir / "models"
    download_root.mkdir(parents=True, exist_ok=True)
    log.info(
        "Loading faster-whisper model %r from %s (first call may download)",
        settings.clipforge_whisper_model,
        download_root,
    )
    _whisper_model = WhisperModel(
        settings.clipforge_whisper_model,
        device="cpu",
        compute_type="int8",
        download_root=str(download_root),
    )
    return _whisper_model


def _transcribe_sync(audio: Path) -> tuple[list[dict], str]:
    model = _get_whisper_model()
    segments, info = model.transcribe(str(audio), beam_size=1, vad_filter=True)
    out = []
    for seg in segments:
        out.append({"start": float(seg.start), "end": float(seg.end), "text": seg.text})
    return out, info.language


def _to_simplified_chinese(segments: list[dict]) -> None:
    """Whisper sometimes emits Traditional characters for Mandarin audio,
    even on mainland-China sources. Convert in place; the conversion table
    is purely Python and is bundled into the desktop installer."""
    from zhconv import convert

    for seg in segments:
        seg["text"] = convert(seg["text"], "zh-cn")


async def transcribe(project_id: str) -> list[dict]:
    """Transcribe the source. Skips re-running Whisper if a transcript already
    exists for this project — re-runs of the pipeline (after a downstream
    stage fails) reuse the prior transcript, since transcribing is by far the
    slowest stage."""
    project = await _get_project(project_id)
    transcript_p = pp.transcript_path(project)
    if transcript_p.exists():
        log.info(
            "[%s] transcript already exists, skipping transcribe (reuse cached)",
            project_id,
        )
        return json.loads(transcript_p.read_text())
    audio_p = pp.audio_path(project)
    if not audio_p.exists():
        await extract_audio(project_id)
    segments, lang = await asyncio.to_thread(_transcribe_sync, audio_p)
    if lang == "zh":
        _to_simplified_chinese(segments)
    transcript_p.write_text(json.dumps(segments, indent=2, ensure_ascii=False))
    return segments


# ---------- cut ----------


def _snap_to_segment_boundary(t: float, segments: list[dict]) -> float:
    """Snap a proposed time to the nearest transcript segment boundary."""
    if not segments:
        return t
    candidates = [0.0]
    for seg in segments:
        candidates.append(float(seg["start"]))
        candidates.append(float(seg["end"]))
    return min(candidates, key=lambda c: abs(c - t))


async def propose_cuts(
    project_id: str, prompt: str, duration_sec: float
) -> list[Cut]:
    project = await _get_project(project_id)
    transcript_p = pp.transcript_path(project)
    if not transcript_p.exists():
        raise RuntimeError("Transcript not found; transcribe first")
    segments = json.loads(transcript_p.read_text())

    provider = get_provider()
    cuts = await provider.propose_cuts(segments, prompt, duration_sec)

    snapped: list[Cut] = []
    for c in cuts:
        start = max(0.0, _snap_to_segment_boundary(c.start_sec, segments))
        end = min(duration_sec, _snap_to_segment_boundary(c.end_sec, segments))
        if end - start < 1.0:
            continue
        snapped.append(Cut(start_sec=start, end_sec=end, title=c.title))

    pp.cuts_path(project).write_text(
        json.dumps(
            [
                {"start_sec": c.start_sec, "end_sec": c.end_sec, "title": c.title}
                for c in snapped
            ],
            indent=2,
            ensure_ascii=False,
        )
    )
    return snapped


# ---------- slice ----------


async def slice_clip(
    project_id: str, clip_id: str, start_sec: float, end_sec: float
) -> Path:
    project = await _get_project(project_id)
    src_path = pp.source_path(project)
    if not src_path.exists():
        raise RuntimeError("Source file not found")
    out_path = pp.clip_path(project, clip_id)
    duration = max(0.1, end_sec - start_sec)
    # -ss after -i is accurate (vs. fast keyframe-snap when before -i).
    code, _, err = await _run(
        ffmpeg_bin("ffmpeg"),
        "-y",
        "-i",
        str(src_path),
        "-ss",
        f"{start_sec:.3f}",
        "-t",
        f"{duration:.3f}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        str(out_path),
    )
    if code != 0:
        raise RuntimeError(f"ffmpeg slice failed: {err.strip()[-500:]}")
    return out_path
