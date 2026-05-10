"""LLM-driven filler / repeat / false-start detection.

Earlier versions of this module did rule-based wordlist matching. That
shipped basically nothing in practice — real filler usage is too varied
(context-dependent words like "you know", "那个", "就是", drawn-out
hesitations, false starts, immediate repetitions) to enumerate. The
detector now delegates to the configured LLM provider's
`propose_polish_cuts`, which receives the per-word transcript and
returns word-index ranges to remove. We map those back to source-time
ranges for the speech mask.

Word-level Whisper output is required (`words: [{start, end, word}]` on
each segment). Without it the detector silently returns no cuts and the
pipeline still produces pause-only cuts.

This module deliberately stays a thin wrapper so the pipeline integration
(`pipeline._build_speech_mask`) doesn't change shape when we evolve the
prompt or add a confirmation pass.
"""

from __future__ import annotations

import logging

from .providers import LlmProvider, get_provider

log = logging.getLogger(__name__)

# Two adjacent polish cuts whose source-time gap is shorter than this and
# contains no surviving Whisper word get merged into one wider cut. The
# motivation is sequences like "um... I I think" — the LLM tags "um" and
# the "I I" repetition separately, but rendering two near-back-to-back
# splices reads as halting playback. Merging them produces one smoother
# splice. The "no word in the gap" check guards against eating real
# words that the LLM happened to leave alone.
MERGE_MAX_GAP_SEC = 0.4


async def detect_filler_ranges(
    segments: list[dict],
    language: str | None,
    provider: LlmProvider | None = None,
) -> list[tuple[float, float, str]]:
    """Return `(src_start, src_end, reason)` per filler/repeat range the
    LLM identified. `reason` is "filler" or "repeat" — the speech-mask
    layer treats both as removable; the API DTO and the UI surface them
    separately so the user can see the breakdown.

    On any provider error this returns []. The pipeline still produces
    pause-only cuts, so a flaky LLM never leaves the project unprocessed.
    """
    if not segments:
        return []
    p = provider or get_provider()
    cuts = await p.propose_polish_cuts(segments, language)
    raw = [(c.src_start, c.src_end, c.reason) for c in cuts]
    return _merge_adjacent_ranges(raw, segments)


def _merge_adjacent_ranges(
    ranges: list[tuple[float, float, str]],
    segments: list[dict],
    max_gap_sec: float = MERGE_MAX_GAP_SEC,
) -> list[tuple[float, float, str]]:
    """Merge polish ranges separated by a short, word-free gap.

    Two cuts close in time produce two splices in the rendered clip —
    each splice carries some discontinuity even with crossfading, so
    fewer = smoother. We merge only when the gap between them contains
    no surviving Whisper word, so we never accidentally cut real speech.
    The merged range inherits the *first* range's reason; if the LLM
    tagged half a sequence as filler and the other half as repeat, the
    user still sees one row in the report (slightly imprecise reason
    label is a worthy tradeoff for cleaner playback).
    """
    if len(ranges) <= 1:
        return ranges
    sorted_ranges = sorted(ranges, key=lambda r: r[0])

    word_spans: list[tuple[float, float]] = []
    for seg in segments:
        for w in seg.get("words") or []:
            try:
                ws = float(w.get("start", 0.0))
                we = float(w.get("end", 0.0))
            except (TypeError, ValueError):
                continue
            if we > ws:
                word_spans.append((ws, we))
    word_spans.sort()

    def has_word_in_gap(a: float, b: float) -> bool:
        if b <= a:
            return False
        # Linear scan — N is small (one transcript's worth, a few thousand).
        for ws, we in word_spans:
            if we <= a:
                continue
            if ws >= b:
                return False
            # Some part of [ws, we] falls inside (a, b).
            return True
        return False

    out: list[tuple[float, float, str]] = [sorted_ranges[0]]
    merged_count = 0
    for cur in sorted_ranges[1:]:
        prev = out[-1]
        gap = cur[0] - prev[1]
        # Tolerance avoids a false "word in gap" hit at exact boundaries
        # — Whisper's word.end and our cut.src_start often coincide for
        # back-to-back filler words.
        if gap < max_gap_sec and not has_word_in_gap(prev[1] + 0.01, cur[0] - 0.01):
            out[-1] = (prev[0], max(prev[1], cur[1]), prev[2])
            merged_count += 1
        else:
            out.append(cur)
    if merged_count:
        log.info(
            "polish: merged %d adjacent range pair%s (max-gap=%.2fs, no surviving words in gap)",
            merged_count,
            "" if merged_count == 1 else "s",
            max_gap_sec,
        )
    return out


def log_filler_cuts(
    project_id: str,
    ranges: list[tuple[float, float, str]],
    segments: list[dict],
) -> None:
    """One INFO line per polish cut, with a few words of surrounding
    context — mirrors `_log_silence_cuts` in pipeline so the user can
    eyeball whether the LLM is making sensible calls."""
    if not ranges:
        log.info("[%s] polish-removal: 0 cuts", project_id)
        return

    flat: list[dict] = []
    for seg in segments:
        for w in seg.get("words") or []:
            flat.append(w)

    def context_at(t: float) -> str:
        # Find the word whose start matches t and return ~5 words around it.
        best = -1
        best_dist = 0.25
        for i, w in enumerate(flat):
            try:
                d = abs(float(w.get("start", 0.0)) - t)
            except (TypeError, ValueError):
                continue
            if d < best_dist:
                best, best_dist = i, d
        if best < 0:
            return ""
        lo = max(0, best - 4)
        hi = min(len(flat), best + 5)
        return "".join(
            f"[{str(flat[j].get('word', ''))}]"
            if j == best
            else str(flat[j].get("word", ""))
            for j in range(lo, hi)
        )

    by_reason: dict[str, int] = {}
    total = 0.0
    for s, e, r in ranges:
        by_reason[r] = by_reason.get(r, 0) + 1
        total += max(0.0, e - s)
    summary = ", ".join(f"{n} {r}" for r, n in by_reason.items())
    log.info(
        "[%s] polish-removal: %d cut%s (%s), %.1fs total removed",
        project_id,
        len(ranges),
        "" if len(ranges) == 1 else "s",
        summary,
        total,
    )
    for i, (s, e, r) in enumerate(ranges, start=1):
        m, sec = divmod(s, 60.0)
        log.info(
            "[%s]   polish #%d: %d:%05.2f (-%.2fs, %s)  ctx:%r",
            project_id,
            i,
            int(m),
            sec,
            e - s,
            r,
            context_at(s),
        )
