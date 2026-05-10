import json
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

log = logging.getLogger(__name__)

# Two cuts whose start times are closer than this are treated as duplicates by
# dedupe_cuts(). The chunked map-reduce path (see each provider) gives every
# anchor window a small overlap on each side, which is what produces the
# near-duplicate cuts this constant cleans up.
DEDUP_PROXIMITY_SEC = 5.0

# A polish cut shorter than this is dropped — likely a model artifact
# (e.g. the LLM marked a single character that's not actually a filler).
MIN_POLISH_CUT_SEC = 0.05


@dataclass
class Cut:
    start_sec: float
    end_sec: float
    title: str


@dataclass
class PolishCut:
    """One source-time range the LLM thinks the speaker said unconsciously
    and would benefit from being removed for cleaner playback. `reason` is
    the bucket the model put it in: 'filler' (um, uh, you know, 嗯, 呃),
    'repeat' (immediate repetition / false start). Open-ended so future
    classifiers can land here without a schema bump."""

    src_start: float
    src_end: float
    reason: str


class LlmProvider(ABC):
    @abstractmethod
    async def propose_cuts(
        self,
        transcript_segments: list[dict],
        cutting_prompt: str,
        source_duration_sec: float,
    ) -> list[Cut]:
        """Given a transcript and the user's cutting instruction, return clip
        boundaries. Implementations should return cuts that are within
        [0, source_duration_sec] and don't egregiously overlap."""

    @abstractmethod
    async def propose_polish_cuts(
        self,
        transcript_segments: list[dict],
        language: str | None,
    ) -> list[PolishCut]:
        """Identify spans of words the speaker said unconsciously (filler
        sounds, false starts, immediate repetitions) — material that
        wouldn't survive an editor's pass. Each segment is expected to
        carry a `words: [{start, end, word}]` field from Whisper's
        word-level timestamps; the LLM picks word-index ranges (we map
        them back to source-time here so the model can't fabricate
        timestamps). Implementations should return [] on transient
        failure rather than raising — pause cuts continue to ship even
        if the polish pass is offline."""


def parse_cuts_from_malformed_arguments(text: str) -> list:
    """Salvage `cuts` entries from a malformed `{"cuts": [...]}` wrapper.

    Used when the OpenAI-compatible tool-call `arguments` string itself
    fails `json.loads` — typically a missing comma between elements, an
    unescaped quote in a title, or a truncated stream. Locates the cuts
    array by name and runs the same partial-array parser, so we ship
    the complete cut objects that came through instead of failing the
    whole pipeline.

    Returns [] if the cuts key isn't present, the array start can't be
    located, or the cuts field is wrapped as a JSON-encoded string
    (the inner-string path handles that case once the outer parse
    succeeds; un-escaping a truncated string here is more brittle than
    worth it).
    """
    key_idx = text.find('"cuts"')
    if key_idx < 0:
        return []
    bracket_idx = text.find("[", key_idx)
    if bracket_idx < 0:
        return []
    if '"' in text[key_idx + len('"cuts"'):bracket_idx]:
        return []
    return parse_json_array_partial(text[bracket_idx:])


def parse_json_array_partial(text: str) -> list:
    """Parse a JSON array that may have been truncated mid-output.

    Used to recover from a specific failure mode in LLM tool output:
    occasionally the model wraps an array as a JSON-encoded *string*
    (instead of returning a structured array) and that string then gets
    cut off by max_tokens, leaving us with a malformed "[\\n  {…},\\n  {…},\\n  {…"
    payload that fails json.loads. Rather than fail the whole pipeline,
    we salvage the complete `{…}` objects that did make it through and
    drop the truncated tail.

    Returns the list of complete objects (possibly empty if recovery
    failed at the very first object). The caller should still treat a
    short return value as a partial result and log a warning.
    """
    text = text.strip()
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        pass

    if not text.startswith("["):
        return []

    out: list = []
    i = 1  # skip opening '['
    n = len(text)
    while i < n:
        # Skip whitespace and inter-element commas.
        while i < n and text[i] in " \n\r\t,":
            i += 1
        if i >= n or text[i] == "]":
            break
        if text[i] != "{":
            # Unexpected token — bail with what we have so far.
            break
        # Walk to the matching close brace, respecting strings + escapes
        # so a `}` inside a JSON string doesn't close prematurely.
        depth = 0
        j = i
        in_string = False
        escape = False
        while j < n:
            ch = text[j]
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
            else:
                if ch == '"':
                    in_string = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        break
            j += 1
        if depth != 0 or j >= n:
            # Hit the truncation — stop with what we've accumulated.
            break
        chunk = text[i : j + 1]
        try:
            out.append(json.loads(chunk))
        except json.JSONDecodeError:
            break
        i = j + 1
    return out


def flatten_words(segments: list[dict]) -> list[dict]:
    """Concatenate per-segment word lists into a flat array with global
    indices. Returns `[{idx, word, start, end}, ...]`. Segments without
    word-level data (legacy transcripts) silently contribute nothing —
    the caller falls back to a no-op polish pass in that case."""
    flat: list[dict] = []
    for seg in segments:
        for w in seg.get("words") or []:
            try:
                start = float(w.get("start", 0.0))
                end = float(w.get("end", 0.0))
            except (TypeError, ValueError):
                continue
            text = str(w.get("word", "")).strip()
            if not text or end <= start:
                continue
            flat.append({"idx": len(flat), "word": text, "start": start, "end": end})
    return flat


def render_word_list(words: list[dict]) -> str:
    """Format the word list for the LLM prompt. One word per line keeps
    indices unambiguous and readable; the model picks ranges by index."""
    return "\n".join(f"{w['idx']}: {w['word']}" for w in words)


def polish_cuts_from_index_ranges(
    words: list[dict],
    raw: list[dict],
) -> list[PolishCut]:
    """Map LLM-returned word-index ranges back to source-time PolishCut
    objects. Tolerant of the usual model quirks: out-of-range indices
    get clamped, swapped from/to gets reordered, missing reason defaults
    to 'filler'."""
    if not words:
        return []
    last_idx = len(words) - 1
    out: list[PolishCut] = []
    for entry in raw:
        if not isinstance(entry, dict):
            log.warning("polish: dropping non-dict cut entry %r", entry)
            continue
        try:
            i = int(entry.get("from"))
            j = int(entry.get("to"))
        except (TypeError, ValueError):
            log.warning("polish: dropping cut with non-int from/to: %r", entry)
            continue
        if i > j:
            i, j = j, i
        i = max(0, min(last_idx, i))
        j = max(0, min(last_idx, j))
        start = words[i]["start"]
        end = words[j]["end"]
        if end - start < MIN_POLISH_CUT_SEC:
            continue
        reason = str(entry.get("reason") or "filler").lower()
        if reason not in ("filler", "repeat"):
            reason = "filler"
        out.append(PolishCut(src_start=start, src_end=end, reason=reason))
    out.sort(key=lambda c: c.src_start)
    return out


def dedupe_cuts(cuts: list[Cut]) -> list[Cut]:
    """Drop near-duplicate cuts that came from chunk overlap regions.

    Two cuts whose start times are within DEDUP_PROXIMITY_SEC are treated as
    duplicates; we keep the longer one (better lead-in/lead-out coverage).
    """
    cuts = sorted(cuts, key=lambda c: c.start_sec)
    out: list[Cut] = []
    for c in cuts:
        if out and abs(c.start_sec - out[-1].start_sec) < DEDUP_PROXIMITY_SEC:
            prev = out[-1]
            if (c.end_sec - c.start_sec) > (prev.end_sec - prev.start_sec):
                out[-1] = c
            continue
        out.append(c)
    return out
