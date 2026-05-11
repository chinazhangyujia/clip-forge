"""Pipeline stages: extract audio, transcribe, propose cuts, slice clips.

Each stage is callable from the worker. Stages are designed to be re-runnable —
they overwrite their output artifact rather than appending. All I/O goes
through the configured BlobStore so we get the same code path in dev (local
files) and prod (S3) once the prod store is wired up.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path

from . import _project_paths as pp
from . import audio_snap, silence
from . import filler as filler_mod
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
    try:
        out, err = await proc.communicate()
    except asyncio.CancelledError:
        # Caller was cancelled (e.g. client disconnected mid-download).
        # Kill the subprocess so abandoned ffmpegs don't pile up and pin
        # CPU/disk — a real failure mode on slow Windows laptops where
        # the user mashes Download after the first attempt seems frozen.
        if proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=5.0)
            except TimeoutError:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()
                with contextlib.suppress(BaseException):
                    await proc.wait()
        raise
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
    """Run Whisper with word-level timestamps.

    Word timing roughly doubles transcript size and adds ~10% to
    transcribe time, but it's required for the filler-word cutter (which
    needs to know exactly where in a segment each "um" / "嗯" falls).
    Long-pause cuts still happen between segment boundaries — the per-
    word data is consumed exclusively by `filler.detect_filler_ranges`."""
    model = _get_whisper_model()
    segments, info = model.transcribe(
        str(audio), beam_size=1, vad_filter=True, word_timestamps=True
    )
    out = []
    for seg in segments:
        words = []
        for w in getattr(seg, "words", None) or []:
            words.append(
                {
                    "start": float(w.start),
                    "end": float(w.end),
                    "word": w.word,
                }
            )
        out.append(
            {
                "start": float(seg.start),
                "end": float(seg.end),
                "text": seg.text,
                "words": words,
            }
        )
    return out, info.language


def _to_simplified_chinese(segments: list[dict]) -> None:
    """Whisper sometimes emits Traditional characters for Mandarin audio,
    even on mainland-China sources. Convert in place (segment text + each
    per-word token); the conversion table is purely Python and is bundled
    into the desktop installer."""
    from zhconv import convert

    for seg in segments:
        seg["text"] = convert(seg["text"], "zh-cn")
        for w in seg.get("words") or []:
            if "word" in w:
                w["word"] = convert(w["word"], "zh-cn")


def _segments_with_word_bounds(segments: list[dict]) -> list[dict]:
    """Return segments whose `start`/`end` reflect the full span of their
    spoken words.

    Whisper's segment-level timestamps are derived heuristically and
    occasionally underestimate the true end of the last word — which
    surfaces as a chopped trailing word right before a long-pause cut.
    Word-level timestamps come from cross-attention alignment and are
    generally tighter, so we widen each segment to the union of its
    segment-time bound and its outermost word-time bound. Segments
    without words (e.g. cached transcripts from before
    word_timestamps=True landed) pass through unchanged."""
    out: list[dict] = []
    for seg in segments:
        words = seg.get("words") or []
        if not words:
            out.append(seg)
            continue
        try:
            ws = float(words[0].get("start"))
            we = float(words[-1].get("end"))
        except (TypeError, ValueError):
            out.append(seg)
            continue
        new_seg = dict(seg)
        new_seg["start"] = min(float(seg.get("start", ws)), ws)
        new_seg["end"] = max(float(seg.get("end", we)), we)
        out.append(new_seg)
    return out


async def _build_speech_mask(
    segments: list[dict],
    source_duration_sec: float,
    language: str | None,
    project_id: str,
    audio_path: Path | None = None,
) -> tuple[list[silence.SpeechInterval], list[silence.RemovedCut]]:
    """Build the speech mask + per-cut reason list.

    Stages:
      1. Group transcript segments into speech intervals; gaps longer
         than MAX_PAUSE_SEC become long-pause cuts (rule-based, cheap).
      2. (Optional) Run the LLM polish pass and splice filler / repeat
         cuts into the intervals — gated behind
         `settings.clipforge_polish_cuts_enabled` (off by default).
      3. (Optional) When `audio_path` is provided and the file exists,
         refine each long-pause boundary against the actual PCM so the
         kept-audio bounds extend to the true silence inside the gap.
         This catches cases where Whisper underestimates a word's true
         end (sustained voiced decay, tone-3 endings, etc.) — without
         it the trailing word audibly chops at the cut.
    """
    from .config import settings

    bounded = _segments_with_word_bounds(segments)
    intervals = silence.compute_speech_intervals(
        bounded, source_duration_sec=source_duration_sec
    )
    if settings.clipforge_polish_cuts_enabled:
        polish_ranges = await filler_mod.detect_filler_ranges(segments, language)
        filler_mod.log_filler_cuts(project_id, polish_ranges, segments)
    else:
        log.info("[%s] polish-removal: disabled via CLIPFORGE_POLISH_CUTS_ENABLED", project_id)
        polish_ranges = []
    intervals, cuts = silence.apply_filler_cuts(intervals, polish_ranges)
    if audio_path is not None and audio_path.exists():
        intervals, cuts = _refine_pause_bounds_with_audio(
            audio_path, intervals, cuts, project_id
        )
    return intervals, cuts


def _refine_pause_bounds_with_audio(
    audio_path: Path,
    intervals: list[silence.SpeechInterval],
    cuts: list[silence.RemovedCut],
    project_id: str,
) -> tuple[list[silence.SpeechInterval], list[silence.RemovedCut]]:
    """Walk each long-pause cut, scan the actual audio in the gap, and
    extend the kept-audio bounds to land in confirmed silence past the
    speech tail / before the speech onset.

    Conservative: only EXTENDS each interval — never shrinks. So if the
    audio analysis is off, the worst case is the heuristic padding that
    was already there. No effect at all when the gap has no detectable
    silence run (returned None from `audio_snap.find_silence_in_gap`).
    """
    if len(intervals) < 2:
        return intervals, cuts
    samples, sr = audio_snap.load_pcm(audio_path)
    if samples is None:
        return intervals, cuts

    # Identify which inter-interval gaps are pause cuts (vs polish cuts).
    pause_gap_starts = {
        round(c.src_start, 3) for c in cuts if c.reason == "pause"
    }
    pause_gap_ends = {round(c.src_end, 3) for c in cuts if c.reason == "pause"}

    bounds: list[tuple[float, float]] = [
        (iv.src_start, iv.src_end) for iv in intervals
    ]
    extended_trailing = 0
    extended_leading = 0
    extension_total = 0.0

    for i in range(len(intervals) - 1):
        prev_end = bounds[i][1]
        next_start = bounds[i + 1][0]
        # Only refine pause-cut gaps. Polish cuts are tight, mid-phrase,
        # and the audio-snap "find the longest silent run" heuristic
        # doesn't apply there.
        if round(prev_end, 3) not in pause_gap_starts:
            continue
        if round(next_start, 3) not in pause_gap_ends:
            continue
        result = audio_snap.find_silence_in_gap(
            samples, sr, gap_start=prev_end, gap_end=next_start
        )
        if result is None:
            continue
        new_prev_end = max(prev_end, result.silence_start + audio_snap.EDGE_PAD_SEC)
        new_next_start = min(next_start, result.silence_end - audio_snap.EDGE_PAD_SEC)
        # Sanity: never let the two extensions cross.
        if new_prev_end >= new_next_start:
            continue
        if new_prev_end > prev_end:
            extension_total += new_prev_end - prev_end
            extended_trailing += 1
            bounds[i] = (bounds[i][0], new_prev_end)
        if new_next_start < next_start:
            extension_total += next_start - new_next_start
            extended_leading += 1
            bounds[i + 1] = (new_next_start, bounds[i + 1][1])

    if extended_trailing == 0 and extended_leading == 0:
        log.info("[%s] audio-snap: 0 boundaries needed extension", project_id)
        return intervals, cuts

    # Rebuild intervals with refined bounds + recompute compact times.
    rebuilt: list[silence.SpeechInterval] = []
    compact_t = 0.0
    for s, e in bounds:
        if e - s < silence.MIN_INTERVAL_SEC:
            continue
        dur = e - s
        rebuilt.append(
            silence.SpeechInterval(
                src_start=s,
                src_end=e,
                compact_start=compact_t,
                compact_end=compact_t + dur,
            )
        )
        compact_t += dur

    # Re-derive pause cuts from the refined gaps; keep polish cuts as-is.
    new_pause_cuts = silence.derive_pause_cuts(rebuilt)
    polish_cuts = [c for c in cuts if c.reason != "pause"]
    new_cuts = sorted(new_pause_cuts + polish_cuts, key=lambda c: c.src_start)
    log.info(
        "[%s] audio-snap: extended %d trailing + %d leading boundaries "
        "(total %.2fs of word audio recovered)",
        project_id,
        extended_trailing,
        extended_leading,
        extension_total,
    )
    return rebuilt, new_cuts


def _fmt_clock(t: float) -> str:
    """`mm:ss.ss` — easier to eyeball against a video timeline than
    `123.4s`."""
    m, s = divmod(max(0.0, t), 60.0)
    return f"{int(m)}:{s:05.2f}"


def _log_silence_cuts(
    project_id: str,
    segments: list[dict],
    intervals: list[silence.SpeechInterval],
    cuts: list[silence.RemovedCut],
) -> None:
    """Print one INFO line per long-pause cut, with the surrounding
    transcript text so the user can verify cuts at a glance. Filler
    cuts have their own log emitted from `filler.log_filler_cuts`, so
    we deliberately only walk pause-tagged entries here."""
    pause_cuts = [c for c in cuts if c.reason == "pause"]
    if not pause_cuts:
        log.info("[%s] silence-removal: 0 cuts (no long pauses found)", project_id)
        return

    def find_before(t: float) -> str:
        # Last segment whose end is at or before this time. Walk backward
        # — segments are time-ordered so the first match is the closest.
        for seg in reversed(segments):
            if seg.get("end", 0) <= t + 0.1:
                return (seg.get("text") or "").strip()[:80]
        return "(start of source)"

    def find_after(t: float) -> str:
        # First segment whose start is at or after this time.
        for seg in segments:
            if seg.get("start", 0) >= t - 0.1:
                return (seg.get("text") or "").strip()[:80]
        return "(end of source)"

    total_removed = sum(c.removed_sec for c in pause_cuts)
    log.info(
        "[%s] silence-removal: %d cut%s, %.1fs total removed",
        project_id,
        len(pause_cuts),
        "" if len(pause_cuts) == 1 else "s",
        total_removed,
    )
    for i, cut in enumerate(pause_cuts, start=1):
        before = find_before(cut.src_start)
        after = find_after(cut.src_end)
        log.info(
            "[%s]   cut #%d: %s → %s (-%.1fs)  before:%r  after:%r",
            project_id,
            i,
            _fmt_clock(cut.src_start),
            _fmt_clock(cut.src_end),
            cut.removed_sec,
            before,
            after,
        )


def _detect_language(segments: list[dict]) -> str | None:
    """Heuristic for cached transcripts that predate language-aware
    pipeline runs: any CJK character in the segment text → 'zh', else
    'en'. Used only as a fallback when speech_intervals.json doesn't
    record the language Whisper detected."""
    for seg in segments:
        for ch in seg.get("text", ""):
            if "一" <= ch <= "鿿":
                return "zh"
    return "en"


async def transcribe(project_id: str) -> list[dict]:
    """Transcribe the source. Skips re-running Whisper if a transcript already
    exists for this project — re-runs of the pipeline (after a downstream
    stage fails) reuse the prior transcript, since transcribing is by far the
    slowest stage. The cheap per-rerun work (speech mask + filler cuts) is
    always rebuilt so wordlist tweaks land without a re-transcribe."""
    project = await _get_project(project_id)
    transcript_p = pp.transcript_path(project)
    speech_p = pp.speech_intervals_path(project)
    if transcript_p.exists():
        log.info(
            "[%s] transcript already exists, skipping transcribe (reuse cached)",
            project_id,
        )
        segments = json.loads(transcript_p.read_text(encoding="utf-8"))
        # Always rebuild the mask + cuts on rerun: filler detection is
        # rule-based, so updating the wordlist or thresholds should take
        # effect by re-running the pipeline (no re-transcribe needed).
        lang = (
            json.loads(speech_p.read_text(encoding="utf-8")).get("language")
            if speech_p.exists()
            else None
        ) or _detect_language(segments)
        ivs, cuts = await _build_speech_mask(
            segments,
            project.source_duration_sec or 0.0,
            lang,
            project_id,
            audio_path=pp.audio_path(project),
        )
        speech_p.write_text(
            json.dumps(
                {**silence.serialize_intervals(ivs, cuts), "language": lang},
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        _log_silence_cuts(project_id, segments, ivs, cuts)
        return segments
    audio_p = pp.audio_path(project)
    if not audio_p.exists():
        await extract_audio(project_id)
    segments, lang = await asyncio.to_thread(_transcribe_sync, audio_p)
    if lang == "zh":
        _to_simplified_chinese(segments)
    transcript_p.write_text(
        json.dumps(segments, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    ivs, cuts = await _build_speech_mask(
        segments,
        project.source_duration_sec or 0.0,
        lang,
        project_id,
        audio_path=audio_p,
    )
    speech_p.write_text(
        json.dumps(
            {**silence.serialize_intervals(ivs, cuts), "language": lang},
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    log.info(
        "[%s] transcribed %d segments, %d speech intervals (compact %.1fs / source %.1fs)",
        project_id,
        len(segments),
        len(ivs),
        silence.compact_total(ivs),
        project.source_duration_sec or 0.0,
    )
    _log_silence_cuts(project_id, segments, ivs, cuts)
    return segments


# ---------- cut ----------


@dataclass(frozen=True)
class ProposedClip:
    """One LLM-proposed clip after silence-aware mapping. `src_start` and
    `src_end` are the outer source-time bounds; `intervals` is the list of
    source-time speech windows the renderer will concat. `removed_cuts`
    are the project-level cuts (long pause + filler) that fell inside
    this clip's outer bounds — surfaced to the UI so the transcript view
    can label each removed range with its reason."""

    title: str
    src_start: float
    src_end: float
    intervals: list[tuple[float, float]]
    removed_cuts: list[silence.RemovedCut]


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
    segments = json.loads(transcript_p.read_text(encoding="utf-8"))

    if speech_p.exists():
        speech_data = json.loads(speech_p.read_text(encoding="utf-8"))
        intervals = silence.deserialize_intervals(speech_data)
        all_removed_cuts = silence.deserialize_cuts(speech_data)
    else:
        intervals, all_removed_cuts = await _build_speech_mask(
            segments,
            duration_sec,
            _detect_language(segments),
            project_id,
            audio_path=pp.audio_path(project),
        )

    if not intervals:
        # Nothing transcribed — nothing to cut.
        pp.cuts_path(project).write_text("[]", encoding="utf-8")
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
        outer_start = src_intervals[0][0]
        outer_end = src_intervals[-1][1]
        proposed.append(
            ProposedClip(
                title=c.title,
                src_start=outer_start,
                src_end=outer_end,
                intervals=src_intervals,
                removed_cuts=silence.cuts_in_source_range(
                    all_removed_cuts, outer_start, outer_end
                ),
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
                    "removed_cuts": [
                        {
                            "src_start": c.src_start,
                            "src_end": c.src_end,
                            "reason": c.reason,
                        }
                        for c in p.removed_cuts
                    ],
                }
                for p in proposed
            ],
            indent=2,
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return proposed


# ---------- slice ----------


# Target audio crossfade duration at every cut seam in the renderer.
# Hard splices (zero crossfade) read as clicks/jumps even when timing is
# right; ~40ms of equal-power crossfade smooths the discontinuity without
# being perceptible as a "fade." Per-pair duration is clamped below so
# we never over-fade on very short intervals.
RENDER_XFADE_SEC = 0.04


def _build_concat_filter(intervals: list[tuple[float, float]]) -> str:
    """Build an ffmpeg `-filter_complex` graph that stitches `intervals`
    into one output (`[outv]` + `[outa]`).

    Video is hard-cut: the cut is meant to be visible (it's a jump-cut
    edit, not a dissolve), and crossfading video would produce a smeary
    transition that looks like a glitch.

    Audio crossfades `RENDER_XFADE_SEC` seconds at every interval
    boundary using equal-power triangular curves. The crossfade overlap
    means the output is shorter than `sum(intervals)` by `Σ pair_d`; we
    compensate by trimming half that overlap from each interior video
    boundary so video and audio stay in lockstep.

    Per-pair fade duration is clamped to 40% of the shorter neighbor —
    on very short intervals (rare; near MIN_INTERVAL_SEC) we'd otherwise
    over-fade and starve `acrossfade` of input. A pair where the clamp
    drives the duration to ~0 falls back to a hard concat so we don't
    emit a broken filter graph.
    """
    if len(intervals) == 1:
        s, e = intervals[0]
        return (
            f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[outv];"
            f"[0:a]atrim=start={s:.3f}:end={e:.3f},asetpts=PTS-STARTPTS[outa]"
        )

    durs = [e - s for s, e in intervals]
    pair_d: list[float] = []
    for i in range(len(intervals) - 1):
        d = min(RENDER_XFADE_SEC, durs[i] * 0.4, durs[i + 1] * 0.4)
        # Anything under ~5ms isn't audibly a crossfade — fall back to a
        # hard splice for that pair.
        pair_d.append(d if d >= 0.005 else 0.0)

    parts: list[str] = []

    # Video — trim each interior boundary by half the pair's fade so the
    # video timeline matches the audio's crossfaded length. Visually,
    # the cut lands at the midpoint of the corresponding audio fade.
    for i, (s, e) in enumerate(intervals):
        left_trim = pair_d[i - 1] / 2 if i > 0 else 0.0
        right_trim = pair_d[i] / 2 if i < len(intervals) - 1 else 0.0
        vs = s + left_trim
        ve = e - right_trim
        parts.append(
            f"[0:v]trim=start={vs:.3f}:end={ve:.3f},setpts=PTS-STARTPTS[v{i}]"
        )
    video_inputs = "".join(f"[v{i}]" for i in range(len(intervals)))
    parts.append(f"{video_inputs}concat=n={len(intervals)}:v=1:a=0[outv]")

    # Audio — extract each interval, then chain crossfades pairwise.
    for i, (s, e) in enumerate(intervals):
        parts.append(
            f"[0:a]atrim=start={s:.3f}:end={e:.3f},asetpts=PTS-STARTPTS[a{i}]"
        )

    prev_label = "a0"
    for i in range(1, len(intervals)):
        d = pair_d[i - 1]
        out_label = f"ax{i}" if i < len(intervals) - 1 else "outa"
        if d <= 0:
            parts.append(
                f"[{prev_label}][a{i}]concat=n=2:v=0:a=1[{out_label}]"
            )
        else:
            parts.append(
                f"[{prev_label}][a{i}]acrossfade=d={d:.3f}:c1=tri:c2=tri[{out_label}]"
            )
        prev_label = out_label

    return ";".join(parts)


# Per-clip lock for slice rendering. Both the on-demand download endpoint
# and the background worker may call into ensure_clip_rendered for the
# same clip; without a shared lock they'd both kick off ffmpeg and race
# on the output path. The dict is bounded by the number of distinct clips
# touched in this process — small for a desktop app.
_render_locks: dict[str, asyncio.Lock] = {}
_render_locks_guard = asyncio.Lock()


async def _get_render_lock(clip_id: str) -> asyncio.Lock:
    async with _render_locks_guard:
        lock = _render_locks.get(clip_id)
        if lock is None:
            lock = asyncio.Lock()
            _render_locks[clip_id] = lock
        return lock


async def ensure_clip_rendered(project_id: str, clip_id: str) -> Path:
    """Idempotent render: if the clip file is already up-to-date, return
    its path immediately; otherwise acquire the per-clip lock, render
    via slice_clip, mark needs_render=False, then return the path.

    Safe to call concurrently for the same clip_id from any number of
    callers — only one ffmpeg runs and the others wait then no-op."""
    ds = get_datastore()
    row = await ds.get_clip(clip_id)
    if row is None:
        raise RuntimeError(f"Clip {clip_id} not found")
    project = await _get_project(project_id)
    path = pp.clip_path(project, clip_id)
    if not row.needs_render and path.exists():
        return path
    lock = await _get_render_lock(clip_id)
    async with lock:
        # Re-check under the lock — a peer call may have just rendered
        # this clip while we waited.
        row = await ds.get_clip(clip_id)
        if row is None:
            raise RuntimeError(f"Clip {clip_id} deleted during render")
        if not row.needs_render and path.exists():
            return path
        intervals = [(iv.start_sec, iv.end_sec) for iv in row.intervals] or [
            (row.start_sec, row.end_sec)
        ]
        await slice_clip(row.project_id, clip_id, intervals)
        await ds.update_clip(
            clip_id,
            {"needs_render": False, "updated_at": int(time.time() * 1000)},
        )
        return path


async def slice_clip(
    project_id: str, clip_id: str, intervals: list[tuple[float, float]]
) -> Path:
    """Render a clip from one or more source-time intervals.

    Single-interval clips take a stream-copy fast path: input-side
    ``-ss`` seeks the demuxer to the keyframe before the requested cut,
    then ``-c copy`` muxes the existing packets into a new mp4 without
    re-encoding. Wall time is dominated by I/O, not CPU — typically
    well under a second for a one-minute clip — which is essential at
    MVP scale (5h source / hundreds of clips, all rendered on demand
    when the user clicks Download). The trade-off: the output starts at
    the keyframe before the requested time, so the head can be up to a
    GOP off (often 1-5s for typical encoder defaults). Re-encoding for
    frame-accuracy is too expensive at this scale to justify for every
    download.

    Multi-interval clips (silence-removed) cannot stream-copy: splicing
    disjoint ranges needs real audio crossfades. They fall through to a
    single re-encode pass via filter_complex; the user accepts the cost
    here because that clip type is opt-in via the auto-cut feature."""
    if not intervals:
        raise RuntimeError(f"slice_clip {clip_id}: no intervals provided")
    project = await _get_project(project_id)
    src_path = pp.source_path(project)
    if not src_path.exists():
        raise RuntimeError("Source file not found")
    out_path = pp.clip_path(project, clip_id)

    if len(intervals) == 1:
        s, e = intervals[0]
        duration = max(e - s, 0.0)
        # Stream-copy: muxes existing packets through, no decode/encode.
        # `-avoid_negative_ts make_zero` normalizes timestamps so players
        # start at t=0; `+faststart` moves moov to the front so the file
        # plays/scrubs immediately without reading the whole tail first.
        code, _, err = await _run(
            ffmpeg_bin("ffmpeg"),
            "-y",
            "-ss",
            f"{s:.3f}",
            "-i",
            str(src_path),
            "-t",
            f"{duration:.3f}",
            "-c",
            "copy",
            "-avoid_negative_ts",
            "make_zero",
            "-movflags",
            "+faststart",
            str(out_path),
        )
        if code == 0:
            return out_path
        # Stream-copy can fail when the source codec doesn't remux cleanly
        # into mp4 (e.g. HEVC-in-MKV with no hvcC metadata, opus audio,
        # weird timestamps). Fall back to a re-encode so the user still
        # gets the clip — slower but works on any input ffmpeg can decode.
        log.warning(
            "[%s] slice_clip stream-copy failed (%s); falling back to re-encode",
            clip_id, err.strip()[-200:],
        )
        code, _, err = await _run(
            ffmpeg_bin("ffmpeg"),
            "-y",
            "-ss",
            f"{s:.3f}",
            "-i",
            str(src_path),
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
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
