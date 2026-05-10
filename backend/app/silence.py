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
from itertools import pairwise
from typing import Literal

# Defaults. Hardcoded for now; promote to per-project settings later if
# someone needs different aggression. These are deliberately conservative
# — natural sentence-end pauses run 0.5–1.2s, so anything shorter than
# MAX_PAUSE_SEC is preserved as-is.
MAX_PAUSE_SEC = 1.5  # pauses longer than this between segments are removed
# Total breath kept across each removed-pause boundary (split half/half:
# 0.4s before the cut + 0.4s after). Bumped from 0.5 → 0.8 after users
# reported the trailing word getting chopped on cuts: Whisper's word-end
# timestamp can underestimate the actual phonation tail by 100–200ms
# (especially on tone-3 Chinese syllables and other words with sustained
# voiced decay), and our 40ms audio crossfade then fades out the
# remaining tail. Wider headroom absorbs the underestimate without
# making cuts feel slow — for a typical 2s pause we still remove ~1.2s.
KEEP_PAUSE_SEC = 0.8
PADDING_SEC = 0.05  # tiny pre/post-roll so consonants survive segment trim
# Polish cuts (filler / repeat) sit inside spoken phrases — trailing
# breath and pre-attack from neighboring words need more headroom than
# the segment-edge case to keep the splice from sounding chopped. Bumped
# from 0.05 → 0.10 after subjective testing surfaced "halting" cuts.
POLISH_EDGE_SEC = 0.10
MIN_INTERVAL_SEC = 0.1  # drop intervals shorter than this (Whisper junk)


# String enum kept open-ended for forward-compat: more reasons (repeat
# phrase, low-value content) will land later under the same shape.
CutReason = Literal["pause", "filler"]


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


@dataclass
class RemovedCut:
    """A source-time range removed from playback, tagged with the reason
    the cutter took it out. Pause cuts come from inter-segment silence;
    filler cuts come from the per-language wordlist + word timestamps."""

    src_start: float
    src_end: float
    reason: CutReason  # "pause" | "filler"

    @property
    def removed_sec(self) -> float:
        return max(0.0, self.src_end - self.src_start)


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


def derive_pause_cuts(intervals: list[SpeechInterval]) -> list[RemovedCut]:
    """Every gap between consecutive intervals is a removed long pause —
    materialize it as an explicit cut so the API can carry the reason."""
    cuts: list[RemovedCut] = []
    for prev, nxt in pairwise(intervals):
        if nxt.src_start - prev.src_end > 0.01:
            cuts.append(
                RemovedCut(
                    src_start=prev.src_end,
                    src_end=nxt.src_start,
                    reason="pause",
                )
            )
    return cuts


def apply_filler_cuts(
    intervals: list[SpeechInterval],
    filler_ranges: list[tuple[float, float, str]],
) -> tuple[list[SpeechInterval], list[RemovedCut]]:
    """Splice filler / repeat ranges into the speech mask.

    Each input range is `(src_start, src_end, reason)` — the reason is
    preserved on the resulting cut so the API can carry "filler" vs
    "repeat" downstream. A range that lands inside an existing speech
    interval splits that interval in two (with `PADDING_SEC` of
    breathing room on each side so consonants survive). Ranges outside
    any speech interval are dropped — they're already in a removed pause.

    Returns the rewritten interval list (compact times re-derived from
    scratch so the compact timeline stays contiguous) and the combined
    cut list (pauses + polish cuts, ordered by source time). Tracking
    polish cuts as we splice — rather than re-deriving from the final
    gap geometry — keeps the per-range reason exact even when a polish
    cut lands adjacent to a long pause.
    """
    pause_cuts = derive_pause_cuts(intervals)
    if not filler_ranges:
        return intervals, pause_cuts

    runs: list[tuple[float, float]] = [(iv.src_start, iv.src_end) for iv in intervals]
    polish_cuts: list[RemovedCut] = []
    # Wider headroom around polish cuts than around segment edges — these
    # land mid-phrase, so trailing breath / pre-attack on the surrounding
    # words needs to survive or the splice sounds chopped.
    edge = POLISH_EDGE_SEC
    for f_start, f_end, reason in sorted(filler_ranges, key=lambda r: r[0]):
        # Find the run containing this range. Scan forward — runs are
        # source-ordered and never overlap, so the first hit is unique.
        for i, (rs, re) in enumerate(runs):
            if rs <= f_start and f_end <= re:
                cs = max(rs, f_start)
                ce = min(re, f_end)
                if ce - cs < 0.05:
                    break
                polish_cuts.append(
                    RemovedCut(src_start=cs, src_end=ce, reason=reason)
                )
                left_e = max(rs, cs - edge)
                right_s = min(re, ce + edge)
                replacement: list[tuple[float, float]] = []
                if left_e - rs >= MIN_INTERVAL_SEC:
                    replacement.append((rs, left_e))
                if re - right_s >= MIN_INTERVAL_SEC:
                    replacement.append((right_s, re))
                runs = runs[:i] + replacement + runs[i + 1 :]
                break

    rebuilt: list[SpeechInterval] = []
    compact_t = 0.0
    for s, e in sorted(runs, key=lambda r: r[0]):
        if e - s < MIN_INTERVAL_SEC:
            continue
        dur = e - s
        rebuilt.append(
            SpeechInterval(
                src_start=s,
                src_end=e,
                compact_start=compact_t,
                compact_end=compact_t + dur,
            )
        )
        compact_t += dur

    all_cuts = sorted(pause_cuts + polish_cuts, key=lambda c: c.src_start)
    return rebuilt, all_cuts


def cuts_in_source_range(
    cuts: list[RemovedCut], src_start: float, src_end: float
) -> list[RemovedCut]:
    """Subset the project-level cut list to those that fall inside a
    clip's outer source-time bounds."""
    return [
        c
        for c in cuts
        if c.src_start >= src_start - 0.01 and c.src_end <= src_end + 0.01
    ]


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
    for prev, nxt in pairwise(intervals):
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
    for prev, nxt in pairwise(intervals):
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


def serialize_intervals(
    intervals: list[SpeechInterval],
    cuts: list[RemovedCut] | None = None,
) -> dict:
    """Serialize the project's speech mask. v2 adds the explicit `cuts`
    list (each tagged with a reason) so the API can carry per-cut metadata
    instead of inferring reasons from gap geometry. v1 mask files predate
    filler support and have pause cuts only — `deserialize_cuts` fills the
    list in by deriving from gaps."""
    if cuts is None:
        cuts = derive_pause_cuts(intervals)
    return {
        "version": 2,
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
        "cuts": [
            {
                "src_start": c.src_start,
                "src_end": c.src_end,
                "reason": c.reason,
            }
            for c in cuts
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


def deserialize_cuts(data: dict) -> list[RemovedCut]:
    """Read the cut list out of a serialized mask. Falls back to deriving
    pause cuts from interval gaps when reading a v1 file (which predates
    the explicit list)."""
    raw_cuts = data.get("cuts")
    if raw_cuts is None:
        return derive_pause_cuts(deserialize_intervals(data))
    return [
        RemovedCut(
            src_start=c["src_start"],
            src_end=c["src_end"],
            reason=c.get("reason", "pause"),
        )
        for c in raw_cuts
    ]
