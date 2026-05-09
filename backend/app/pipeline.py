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
from dataclasses import dataclass
from pathlib import Path

from . import _project_paths as pp
from . import silence
from ._resources import ffmpeg_bin
from .datastore import ProjectRow, get_datastore
from .providers import get_provider

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
    """Run Whisper at segment granularity.

    We deliberately don't enable `word_timestamps`: cuts are made between
    Whisper segments (which are sentence/clause boundaries by design), and
    word-level timing only enabled mid-sentence cuts that turned out to
    feel chopped during playback. Plus per-word timing roughly doubles
    transcript size and adds ~10% to transcribe time."""
    model = _get_whisper_model()
    segments, info = model.transcribe(
        str(audio), beam_size=1, vad_filter=True
    )
    out = []
    for seg in segments:
        out.append(
            {
                "start": float(seg.start),
                "end": float(seg.end),
                "text": seg.text,
            }
        )
    return out, info.language


def _to_simplified_chinese(segments: list[dict]) -> None:
    """Whisper sometimes emits Traditional characters for Mandarin audio,
    even on mainland-China sources. Convert in place; the conversion table
    is purely Python and is bundled into the desktop installer."""
    from zhconv import convert

    for seg in segments:
        seg["text"] = convert(seg["text"], "zh-cn")


def _build_speech_intervals(
    segments: list[dict], source_duration_sec: float
) -> list[silence.SpeechInterval]:
    """Group sentence-level Whisper segments into speech intervals,
    splitting only when the inter-segment pause exceeds the threshold."""
    return silence.compute_speech_intervals(
        segments, source_duration_sec=source_duration_sec
    )


async def transcribe(project_id: str) -> list[dict]:
    """Transcribe the source. Skips re-running Whisper if a transcript already
    exists for this project — re-runs of the pipeline (after a downstream
    stage fails) reuse the prior transcript, since transcribing is by far the
    slowest stage."""
    project = await _get_project(project_id)
    transcript_p = pp.transcript_path(project)
    speech_p = pp.speech_intervals_path(project)
    if transcript_p.exists():
        log.info(
            "[%s] transcript already exists, skipping transcribe (reuse cached)",
            project_id,
        )
        segments = json.loads(transcript_p.read_text())
        if not speech_p.exists():
            # Cached transcript predates the speech-interval artifact —
            # rebuild it from whatever timing the transcript has so the
            # rest of the pipeline can run without a re-transcribe.
            ivs = _build_speech_intervals(
                segments, project.source_duration_sec or 0.0
            )
            speech_p.write_text(
                json.dumps(silence.serialize_intervals(ivs), indent=2)
            )
        return segments
    audio_p = pp.audio_path(project)
    if not audio_p.exists():
        await extract_audio(project_id)
    segments, lang = await asyncio.to_thread(_transcribe_sync, audio_p)
    if lang == "zh":
        _to_simplified_chinese(segments)
    transcript_p.write_text(json.dumps(segments, indent=2, ensure_ascii=False))
    ivs = _build_speech_intervals(segments, project.source_duration_sec or 0.0)
    speech_p.write_text(json.dumps(silence.serialize_intervals(ivs), indent=2))
    log.info(
        "[%s] transcribed %d segments, %d speech intervals (compact %.1fs / source %.1fs)",
        project_id,
        len(segments),
        len(ivs),
        silence.compact_total(ivs),
        project.source_duration_sec or 0.0,
    )
    return segments


# ---------- cut ----------


@dataclass(frozen=True)
class ProposedClip:
    """One LLM-proposed clip after silence-aware mapping. `src_start` and
    `src_end` are the outer source-time bounds; `intervals` is the list of
    source-time speech windows the renderer will concat."""

    title: str
    src_start: float
    src_end: float
    intervals: list[tuple[float, float]]


def _snap_to_boundary(t: float, boundaries: list[float]) -> float:
    if not boundaries:
        return t
    return min(boundaries, key=lambda c: abs(c - t))


def _build_compact_segments(
    segments: list[dict], intervals: list[silence.SpeechInterval]
) -> list[dict]:
    out: list[dict] = []
    for seg in segments:
        cs = silence.source_to_compact(float(seg["start"]), intervals)
        ce = silence.source_to_compact(float(seg["end"]), intervals)
        if ce - cs < 0.1:
            continue
        out.append({"start": cs, "end": ce, "text": seg.get("text", "")})
    return out


async def propose_cuts(
    project_id: str, prompt: str, duration_sec: float
) -> list[ProposedClip]:
    """Drive the LLM cut step. The LLM sees the compact (silence-removed)
    timeline so its 60-second target is 60 seconds of speech; we then map
    each cut back to source-time intervals for the renderer."""
    project = await _get_project(project_id)
    transcript_p = pp.transcript_path(project)
    speech_p = pp.speech_intervals_path(project)
    if not transcript_p.exists():
        raise RuntimeError("Transcript not found; transcribe first")
    segments = json.loads(transcript_p.read_text())

    if speech_p.exists():
        intervals = silence.deserialize_intervals(json.loads(speech_p.read_text()))
    else:
        intervals = _build_speech_intervals(segments, duration_sec)

    if not intervals:
        # Nothing transcribed — nothing to cut.
        pp.cuts_path(project).write_text("[]")
        return []

    compact_segments = _build_compact_segments(segments, intervals)
    compact_total = silence.compact_total(intervals)
    boundaries = sorted(
        {s["start"] for s in compact_segments} | {s["end"] for s in compact_segments}
    )

    provider = get_provider()
    raw_cuts = await provider.propose_cuts(compact_segments, prompt, compact_total)

    proposed: list[ProposedClip] = []
    for c in raw_cuts:
        cs = max(0.0, _snap_to_boundary(c.start_sec, boundaries))
        ce = min(compact_total, _snap_to_boundary(c.end_sec, boundaries))
        if ce - cs < 1.0:
            continue
        src_intervals = silence.compact_range_to_source_intervals(cs, ce, intervals)
        if not src_intervals:
            continue
        proposed.append(
            ProposedClip(
                title=c.title,
                src_start=src_intervals[0][0],
                src_end=src_intervals[-1][1],
                intervals=src_intervals,
            )
        )

    pp.cuts_path(project).write_text(
        json.dumps(
            [
                {
                    "title": p.title,
                    "src_start": p.src_start,
                    "src_end": p.src_end,
                    "intervals": [
                        {"start_sec": s, "end_sec": e} for s, e in p.intervals
                    ],
                }
                for p in proposed
            ],
            indent=2,
            ensure_ascii=False,
        )
    )
    return proposed


# ---------- slice ----------


def _build_concat_filter(intervals: list[tuple[float, float]]) -> str:
    """Build an ffmpeg `-filter_complex` graph that trims [v]+[a] per
    interval and concats the trimmed pieces. Both streams are trimmed at
    identical timestamps so audio and video stay in sync across cuts."""
    parts: list[str] = []
    interleaved: list[str] = []
    for i, (s, e) in enumerate(intervals):
        parts.append(
            f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[v{i}]"
        )
        parts.append(
            f"[0:a]atrim=start={s:.3f}:end={e:.3f},asetpts=PTS-STARTPTS[a{i}]"
        )
        interleaved.append(f"[v{i}][a{i}]")
    parts.append(
        f"{''.join(interleaved)}concat=n={len(intervals)}:v=1:a=1[outv][outa]"
    )
    return ";".join(parts)


async def slice_clip(
    project_id: str, clip_id: str, intervals: list[tuple[float, float]]
) -> Path:
    """Render a clip from one or more source-time intervals.

    A clip with a single interval renders the obvious sub-range. A clip
    with multiple intervals (silence-removed) is built via filter_complex:
    every interval becomes a (trim, atrim) pair, then everything is
    concat'd. Single re-encode pass."""
    if not intervals:
        raise RuntimeError(f"slice_clip {clip_id}: no intervals provided")
    project = await _get_project(project_id)
    src_path = pp.source_path(project)
    if not src_path.exists():
        raise RuntimeError("Source file not found")
    out_path = pp.clip_path(project, clip_id)

    fc = _build_concat_filter(intervals)
    code, _, err = await _run(
        ffmpeg_bin("ffmpeg"),
        "-y",
        "-i",
        str(src_path),
        "-filter_complex",
        fc,
        "-map",
        "[outv]",
        "-map",
        "[outa]",
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
