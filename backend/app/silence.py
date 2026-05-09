"""Speech-interval detection and compact-time mapping.

The pipeline produces ~1 minute clips for social platforms, and a 1 minute
clip with 20 seconds of dead air feels half as long as a 1 minute clip with
20 seconds of cuts. This module turns Whisper *segment* timestamps into a
"speech mask" — a list of source-time speech windows separated by removable
pauses — and provides the compact↔source mappings the rest of the pipeline
needs:

  - The LLM proposes cuts on the compact timeline so its 60 second budget
    is 60 seconds of speech.
  - The renderer concats source-time intervals to produce the final clip.
  - The trim panel uses the mask as a backdrop so the user can see which
    parts of the source survived.

Why segment-level (not word-level): Whisper segments break at natural
sentence/clause boundaries (punctuation, intonation drops). Cutting only
between segments means cuts always land on a sentence break — no
mid-clause stitches, no "bite-at-a-time" rhythm. Word-level cuts produced
many micro-pauses inside a sentence, which both sounded chopped and
forced a browser-seek per cut during in-app playback (each seek causes a
visible decode hiccup).

Pauses shorter than `MAX_PAUSE_SEC` pass through unchanged — normal
sentence-end breaths stay. Pauses longer than that have `KEEP_PAUSE_SEC`
of natural breath baked into the interval bounds (half on each side) so
the renderer's concat and the player's source-time skip both produce
audible breathing room at every cut.
"""

from __future__ import annotations

from dataclasses import dataclass

# Defaults. Hardcoded for now; promote to per-project settings later if
# someone needs different aggression. These are deliberately conservative
# — natural sentence-end pauses run 0.5–1.2s, so anything shorter than
# MAX_PAUSE_SEC is preserved as-is.
MAX_PAUSE_SEC = 1.5  # pauses longer than this between segments are removed
KEEP_PAUSE_SEC = 0.5  # natural breath kept at every removed-pause boundary
PADDING_SEC = 0.05  # tiny pre/post-roll so consonants survive segment trim
MIN_INTERVAL_SEC = 0.1  # drop intervals shorter than this (Whisper junk)


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
    spans: list[dict],
    *,
    source_duration_sec: float,
    max_pause_sec: float = MAX_PAUSE_SEC,
    keep_pause_sec: float = KEEP_PAUSE_SEC,
    padding_sec: float = PADDING_SEC,
) -> list[SpeechInterval]:
    """Group `{start, end, ...}` spans into speech intervals.

    Spans are typically Whisper segments (sentence-ish chunks), but the
    function works on any sorted list of `{start, end}` records. Pauses
    longer than `max_pause_sec` between consecutive spans split the run
    into separate intervals; shorter pauses are absorbed into the same
    interval (so normal sentence-end breaths stay intact).

    The kept pause is *baked into the interval bounds*, not inserted as a
    compact-time gap: every interval expands by up to `keep_pause_sec / 2`
    on each side that abuts a long pause, so the renderer (which concats
    with no gap) and the player (which jumps from `iv[i].end` straight to
    `iv[i+1].start`) naturally include `keep_pause_sec` of natural breath
    at every boundary.
    """
    cleaned = [s for s in spans if s.get("end", 0) > s.get("start", 0)]
    if not cleaned:
        return []
    cleaned.sort(key=lambda s: s["start"])

    runs: list[tuple[float, float]] = []
    run_start = cleaned[0]["start"]
    run_end = cleaned[0]["end"]
    for s in cleaned[1:]:
        gap = s["start"] - run_end
        if gap > max_pause_sec:
            runs.append((run_start, run_end))
            run_start = s["start"]
            run_end = s["end"]
        else:
            run_end = max(run_end, s["end"])
    runs.append((run_start, run_end))

    half_keep = keep_pause_sec / 2

    def _pre_pad(i: int, s: float) -> float:
        if i == 0:
            return padding_sec
        prev_end = runs[i - 1][1]
        gap = s - prev_end
        # Long pause being removed → borrow up to half the kept pause as
        # lead-in. Short pause case can't reach here (run-merge above).
        return min(half_keep, gap / 2) if gap > max_pause_sec else padding_sec

    def _post_pad(i: int, e: float) -> float:
        if i == len(runs) - 1:
            return padding_sec
        next_start = runs[i + 1][0]
        gap = next_start - e
        return min(half_keep, gap / 2) if gap > max_pause_sec else padding_sec

    intervals: list[SpeechInterval] = []
    compact_t = 0.0
    for i, (s, e) in enumerate(runs):
        ps = max(0.0, s - _pre_pad(i, s))
        pe = min(source_duration_sec, e + _post_pad(i, e))
        if pe - ps < MIN_INTERVAL_SEC:
            continue
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
