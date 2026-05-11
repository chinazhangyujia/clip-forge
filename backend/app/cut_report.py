"""Build the project-level cut report.

The Project Detail "Auto-cuts" report needs every removed range across the
*whole* source video — not just the per-clip subset that the Clip schema
already carries. Cuts that fall inside a clip get a `clip_id` so the UI
can deep-link to that moment; cuts that fall outside any clip surface as
non-navigable rows ("outside any clip" affordance).

Per-cut context — `pre`/`post` excerpts for pause cuts, the literal token
+ surrounding words for filler cuts — is computed here from the cached
transcript + word timestamps so the API answer is self-contained (no
follow-up requests required to render a row).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import _project_paths as pp
from . import silence
from .datastore import ClipRow, ProjectRow

# How much surrounding text to ship per cut. Pause excerpts are full
# sentence-ish snippets; filler context is a few words on each side of
# the removed token.
PAUSE_EXCERPT_CHARS = 110
FILLER_CONTEXT_WORDS = 5


def _truncate_left(text: str, n: int) -> str:
    """Keep the *last* n chars (closest to the cut) — pause `pre` excerpts
    care about what was just said, not what started the sentence."""
    s = text.strip()
    return s if len(s) <= n else "…" + s[-n:].lstrip()


def _truncate_right(text: str, n: int) -> str:
    """Keep the *first* n chars — pause `post` excerpts care about what
    came right after the silence."""
    s = text.strip()
    return s if len(s) <= n else s[:n].rstrip() + "…"


def _segment_before(segments: list[dict], t: float) -> str:
    """Last segment whose end is at or before the cut start."""
    last = ""
    for seg in segments:
        end = float(seg.get("end", 0))
        if end <= t + 0.05:
            last = seg.get("text", "")
        else:
            break
    return last


def _segment_after(segments: list[dict], t: float) -> str:
    """First segment whose start is at or after the cut end."""
    for seg in segments:
        if float(seg.get("start", 0)) >= t - 0.05:
            return seg.get("text", "")
    return ""


def _segment_containing(segments: list[dict], t: float) -> dict | None:
    for seg in segments:
        if float(seg.get("start", 0)) - 0.05 <= t <= float(seg.get("end", 0)) + 0.05:
            return seg
    return None


def _normalize_word(w: str) -> str:
    return re.sub(r"[\s\.,!?。，！？、…—\-]+", "", w).strip()


def _filler_context(
    segments: list[dict], cut: silence.RemovedCut
) -> tuple[str, str, str]:
    """Find the word matching this cut and the surrounding words. Returns
    (pre_text, word, post_text). Falls back to the segment text on either
    side if word-level data isn't present (legacy transcripts)."""
    seg = _segment_containing(segments, (cut.src_start + cut.src_end) / 2)
    if not seg:
        return "", "", ""
    words = seg.get("words") or []
    if not words:
        return _truncate_left(seg.get("text", ""), 60), "", ""
    # Match the word whose start is closest to the cut start.
    best_idx = -1
    best_dist = 0.25  # require it to actually overlap the cut window
    for i, w in enumerate(words):
        dist = abs(float(w.get("start", 0)) - cut.src_start)
        if dist < best_dist:
            best_dist = dist
            best_idx = i
    if best_idx < 0:
        return _truncate_left(seg.get("text", ""), 60), "", ""
    lo = max(0, best_idx - FILLER_CONTEXT_WORDS)
    hi = min(len(words), best_idx + FILLER_CONTEXT_WORDS + 1)
    pre = "".join(str(w.get("word", "")) for w in words[lo:best_idx]).strip()
    post = "".join(str(w.get("word", "")) for w in words[best_idx + 1 : hi]).strip()
    word = _normalize_word(str(words[best_idx].get("word", "")))
    return pre, word, post


def _clip_for_cut(cut: silence.RemovedCut, clips: list[ClipRow]) -> str | None:
    """Return the clip whose outer source-time bounds contain the cut, or
    None if it falls in a region the LLM didn't promote into a clip."""
    mid = (cut.src_start + cut.src_end) / 2
    for c in clips:
        if c.start_sec - 0.05 <= mid <= c.end_sec + 0.05:
            return c.id
    return None


def build_report(
    project: ProjectRow, clips: list[ClipRow]
) -> list[dict]:
    """Materialize the cut report for one project. Reads the cached mask
    (`speech_intervals.json`) and transcript on disk. Returns a list of
    plain dicts ready to ship as the API DTO; ordering is source-time
    ascending (the UI re-sorts as needed).
    """
    speech_p = pp.speech_intervals_path(project)
    transcript_p = pp.transcript_path(project)
    if not speech_p.exists() or not transcript_p.exists():
        return []

    speech_data = json.loads(Path(speech_p).read_text(encoding="utf-8"))
    cuts = silence.deserialize_cuts(speech_data)
    segments = json.loads(Path(transcript_p).read_text(encoding="utf-8"))

    # `clips` is small (≤ a couple hundred); a linear scan per cut is fine.
    out: list[dict] = []
    for i, cut in enumerate(sorted(cuts, key=lambda c: c.src_start)):
        clip_id = _clip_for_cut(cut, clips)
        row: dict = {
            "id": f"{project.id}-cut{i + 1}",
            "source_sec": round(cut.src_start, 2),
            "source_end_sec": round(cut.src_end, 2),
            "removed_sec": round(cut.removed_sec, 2),
            "reason": cut.reason,
            "clip_id": clip_id,
        }
        if cut.reason == "pause":
            pre_seg = _segment_before(segments, cut.src_start)
            post_seg = _segment_after(segments, cut.src_end)
            row["pre"] = _truncate_left(pre_seg, PAUSE_EXCERPT_CHARS)
            row["post"] = _truncate_right(post_seg, PAUSE_EXCERPT_CHARS)
            row["word"] = None
        elif cut.reason == "filler":
            pre, word, post = _filler_context(segments, cut)
            row["pre"] = pre
            row["post"] = post
            row["word"] = word
        else:
            row["pre"] = ""
            row["post"] = ""
            row["word"] = None
        out.append(row)
    return out
