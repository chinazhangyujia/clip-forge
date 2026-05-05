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

from .blobstore import (
    audio_key,
    clip_key,
    cuts_key,
    get_blobstore,
    source_key,
    transcript_key,
)
from .datastore import get_datastore
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
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(source),
    )
    if code != 0:
        raise RuntimeError(f"ffprobe failed: {err.strip()}")
    return float(out.strip())


async def _source_path_for(project_id: str) -> Path:
    ds = get_datastore()
    bs = get_blobstore()
    project = await ds.get_project(project_id)
    if project is None:
        raise RuntimeError(f"Project {project_id} not found")
    ext = Path(project.source_filename or "source.mp4").suffix.lower() or ".mp4"
    return bs.local_path(source_key(project_id, ext))


async def extract_audio(project_id: str) -> Path:
    bs = get_blobstore()
    src_path = await _source_path_for(project_id)
    if not src_path.exists():
        raise RuntimeError("Source file not found in blob store")
    out_path = bs.local_path(audio_key(project_id))
    code, _, err = await _run(
        "ffmpeg",
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

    from .config import settings

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


def _transcribe_sync(audio: Path) -> list[dict]:
    model = _get_whisper_model()
    segments, _info = model.transcribe(str(audio), beam_size=1, vad_filter=True)
    out = []
    for seg in segments:
        out.append({"start": float(seg.start), "end": float(seg.end), "text": seg.text})
    return out


async def transcribe(project_id: str) -> list[dict]:
    """Transcribe the source. Skips re-running Whisper if a transcript already
    exists for this project — re-runs of the pipeline (after a downstream
    stage fails) reuse the prior transcript, since transcribing is by far the
    slowest stage."""
    bs = get_blobstore()
    if await bs.exists(transcript_key(project_id)):
        log.info(
            "[%s] transcript already exists, skipping transcribe (reuse cached)",
            project_id,
        )
        return json.loads(await bs.read_text(transcript_key(project_id)))
    audio_p = bs.local_path(audio_key(project_id))
    if not audio_p.exists():
        await extract_audio(project_id)
    segments = await asyncio.to_thread(_transcribe_sync, audio_p)
    await bs.write_text(
        transcript_key(project_id),
        json.dumps(segments, indent=2, ensure_ascii=False),
    )
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
    bs = get_blobstore()
    if not await bs.exists(transcript_key(project_id)):
        raise RuntimeError("Transcript not found; transcribe first")
    segments = json.loads(await bs.read_text(transcript_key(project_id)))

    provider = get_provider()
    cuts = await provider.propose_cuts(segments, prompt, duration_sec)

    snapped: list[Cut] = []
    for c in cuts:
        start = max(0.0, _snap_to_segment_boundary(c.start_sec, segments))
        end = min(duration_sec, _snap_to_segment_boundary(c.end_sec, segments))
        if end - start < 1.0:
            continue
        snapped.append(Cut(start_sec=start, end_sec=end, title=c.title))

    await bs.write_text(
        cuts_key(project_id),
        json.dumps(
            [
                {"start_sec": c.start_sec, "end_sec": c.end_sec, "title": c.title}
                for c in snapped
            ],
            indent=2,
            ensure_ascii=False,
        ),
    )
    return snapped


# ---------- slice ----------


async def slice_clip(
    project_id: str, clip_id: str, start_sec: float, end_sec: float
) -> Path:
    bs = get_blobstore()
    src_path = await _source_path_for(project_id)
    if not src_path.exists():
        raise RuntimeError("Source file not found")
    out_path = bs.local_path(clip_key(project_id, clip_id))
    duration = max(0.1, end_sec - start_sec)
    # -ss after -i is accurate (vs. fast keyframe-snap when before -i).
    code, _, err = await _run(
        "ffmpeg",
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
