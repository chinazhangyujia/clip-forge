"""Speech-interval detection and compact-time mapping.

The pipeline produces ~1 minute clips for social platforms, and a 1 minute
clip with 20 seconds of dead air feels half as long as a 1 minute clip with
20 seconds of cuts. This module turns Whisper word-level timestamps into a
"speech mask" — a list of source-time speech windows separated by removable
pauses — and provides the compact↔source mappings the rest of the pipeline
needs:

  - The LLM proposes cuts on the compact timeline so its 60 second budget
    is 60 seconds of speech.
  - The renderer concats source-time intervals to produce the final clip.
  - The trim panel uses the mask as a backdrop so the user can see which
    parts of the source survived.

Pauses shorter than `MAX_PAUSE_SEC` pass through unchanged — natural breaths
between phrases stay. Pauses longer than that are clamped to `KEEP_PAUSE_SEC`
in the compact timeline; "no zero-pause cuts" was an explicit user request.
"""

from __future__ import annotations

from dataclasses import dataclass

# Defaults. Hardcoded for v1; promote to per-project settings later if
# someone needs different aggression.
MAX_PAUSE_SEC = 0.6  # pauses longer than this are removed
KEEP_PAUSE_SEC = 0.4  # how much pause to leave in compact time after removal
PADDING_SEC = 0.05  # tiny pre/post-roll on each interval so consonants survive
MIN_INTERVAL_SEC = 0.05  # drop intervals shorter than this (parser noise)


@dataclass
class SpeechInterval:
    """One contiguous speech window with both timelines pre-computed."""

    src_start: float
    src_end: float
    compact_start: float
    compact_end: float

    @property
    def src_duration(self) -> float:
        return self.src_end - self.src_start


def compute_speech_intervals(
    words: list[dict],
    *,
    source_duration_sec: float,
    max_pause_sec: float = MAX_PAUSE_SEC,
    keep_pause_sec: float = KEEP_PAUSE_SEC,
    padding_sec: float = PADDING_SEC,
) -> list[SpeechInterval]:
    """Group word-level timestamps into speech intervals.

    Each `words` entry is `{start, end, word, ...}` (faster-whisper format
    when word_timestamps=True). Pauses longer than `max_pause_sec` between
    consecutive words start a new interval.

    Intervals carry both source-time bounds and compact-time bounds. The
    compact timeline starts at 0; between consecutive intervals, exactly
    `keep_pause_sec` of compact time elapses.
    """
    cleaned = [w for w in words if w.get("end", 0) > w.get("start", 0)]
    if not cleaned:
        return []
    cleaned.sort(key=lambda w: w["start"])

    runs: list[tuple[float, float]] = []
    run_start = cleaned[0]["start"]
    run_end = cleaned[0]["end"]
    for w in cleaned[1:]:
        gap = w["start"] - run_end
        if gap > max_pause_sec:
            runs.append((run_start, run_end))
            run_start = w["start"]
            run_end = w["end"]
        else:
            run_end = max(run_end, w["end"])
    runs.append((run_start, run_end))

    intervals: list[SpeechInterval] = []
    compact_t = 0.0
    for i, (s, e) in enumerate(runs):
        # Pad and clamp to source bounds.
        ps = max(0.0, s - padding_sec)
        pe = min(source_duration_sec, e + padding_sec)
        if pe - ps < MIN_INTERVAL_SEC:
            continue
        if i > 0 and intervals:
            # Insert the kept pause between this run and the previous one.
            compact_t += keep_pause_sec
        dur = pe - ps
        intervals.append(
            SpeechInterval(
                src_start=ps,
                src_end=pe,
                compact_start=compact_t,
                compact_end=compact_t + dur,
            )
        )
        compact_t += dur
    return intervals


def fallback_intervals_from_segments(
    segments: list[dict],
    *,
    source_duration_sec: float,
    keep_pause_sec: float = KEEP_PAUSE_SEC,
    padding_sec: float = PADDING_SEC,
) -> list[SpeechInterval]:
    """Compute speech intervals from segment-level (no word-level) data.

    Used when a transcript was produced before this feature existed and the
    user opens an old clip without re-running. Each Whisper segment becomes
    one source-time block; long pauses between segments are still removed.
    Less precise than `compute_speech_intervals` because intra-segment
    pauses can't be detected.
    """
    pseudo_words = [
        {"start": s["start"], "end": s["end"], "word": ""}
        for s in segments
        if s.get("end", 0) > s.get("start", 0)
    ]
    return compute_speech_intervals(
        pseudo_words,
        source_duration_sec=source_duration_sec,
        keep_pause_sec=keep_pause_sec,
        padding_sec=padding_sec,
    )


def compact_total(intervals: list[SpeechInterval]) -> float:
    return intervals[-1].compact_end if intervals else 0.0


def source_to_compact(t: float, intervals: list[SpeechInterval]) -> float:
    """Map a source-time point to compact time. Points inside a pause gap
    snap to the start of the next interval (or end of the previous one for
    the very last gap)."""
    if not intervals:
        return max(0.0, t)
    for iv in intervals:
        if iv.src_start <= t <= iv.src_end:
            return iv.compact_start + (t - iv.src_start)
    if t < intervals[0].src_start:
        return 0.0
    for prev, nxt in zip(intervals, intervals[1:], strict=True):
        if prev.src_end < t < nxt.src_start:
            # Pick the closer edge.
            if (t - prev.src_end) <= (nxt.src_start - t):
                return prev.compact_end
            return nxt.compact_start
    return intervals[-1].compact_end


def compact_to_source(t: float, intervals: list[SpeechInterval]) -> float:
    """Map a compact-time point to source time. Compact-time points that
    fall in a kept-pause gap snap to the start of the next interval."""
    if not intervals:
        return max(0.0, t)
    for iv in intervals:
        if iv.compact_start <= t <= iv.compact_end:
            return iv.src_start + (t - iv.compact_start)
    if t < intervals[0].compact_start:
        return intervals[0].src_start
    for prev, nxt in zip(intervals, intervals[1:], strict=True):
        if prev.compact_end < t < nxt.compact_start:
            return nxt.src_start
    return intervals[-1].src_end


def compact_range_to_source_intervals(
    compact_start: float,
    compact_end: float,
    intervals: list[SpeechInterval],
) -> list[tuple[float, float]]:
    """Slice the speech mask by a compact-time window. Returns source-time
    [(s, e), …] pairs ready for the multi-interval renderer."""
    if compact_end <= compact_start or not intervals:
        return []
    out: list[tuple[float, float]] = []
    for iv in intervals:
        if iv.compact_end <= compact_start or iv.compact_start >= compact_end:
            continue
        c_s = max(iv.compact_start, compact_start)
        c_e = min(iv.compact_end, compact_end)
        s = iv.src_start + (c_s - iv.compact_start)
        e = iv.src_start + (c_e - iv.compact_start)
        if e - s > MIN_INTERVAL_SEC:
            out.append((s, e))
    return out


def source_range_to_source_intervals(
    src_start: float,
    src_end: float,
    intervals: list[SpeechInterval],
) -> list[tuple[float, float]]:
    """Slice the speech mask by a source-time window. Used by the trim API
    when the user adjusts a clip's outer bounds: we re-derive the per-clip
    intervals by intersecting the project mask with the new source range."""
    if src_end <= src_start or not intervals:
        return []
    out: list[tuple[float, float]] = []
    for iv in intervals:
        if iv.src_end <= src_start or iv.src_start >= src_end:
            continue
        s = max(iv.src_start, src_start)
        e = min(iv.src_end, src_end)
        if e - s > MIN_INTERVAL_SEC:
            out.append((s, e))
    return out


def serialize_intervals(intervals: list[SpeechInterval]) -> dict:
    return {
        "version": 1,
        "max_pause_sec": MAX_PAUSE_SEC,
        "keep_pause_sec": KEEP_PAUSE_SEC,
        "padding_sec": PADDING_SEC,
        "compact_total_sec": compact_total(intervals),
        "intervals": [
            {
                "src_start": iv.src_start,
                "src_end": iv.src_end,
                "compact_start": iv.compact_start,
                "compact_end": iv.compact_end,
            }
            for iv in intervals
        ],
    }


def deserialize_intervals(data: dict) -> list[SpeechInterval]:
    return [
        SpeechInterval(
            src_start=iv["src_start"],
            src_end=iv["src_end"],
            compact_start=iv["compact_start"],
            compact_end=iv["compact_end"],
        )
        for iv in data.get("intervals", [])
    ]
