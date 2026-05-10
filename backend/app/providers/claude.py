import asyncio
import json
import logging
import time
from dataclasses import dataclass

from anthropic import AsyncAnthropic

from .base import (
    Cut,
    LlmProvider,
    PolishCut,
    dedupe_cuts,
    flatten_words,
    parse_json_array_partial,
    polish_cuts_from_index_ranges,
    render_word_list,
)

log = logging.getLogger(__name__)

# Map-reduce thresholds for long sources (per requirements.md, MVP feature 1).
# Below CHUNK_THRESHOLD_SEC the whole transcript goes to Claude in one call.
# Above it, we slice the transcript into anchor windows (CHUNK_DURATION_SEC
# wide) with CHUNK_OVERLAP_SEC of context on each side so a clip that straddles
# a window boundary is fully visible to at least one chunk. All chunks run in
# parallel and their cuts are then deduplicated by start-time proximity.
CHUNK_THRESHOLD_SEC = 45 * 60
CHUNK_DURATION_SEC = 30 * 60
CHUNK_OVERLAP_SEC = 2 * 60

# Anthropic Claude pricing (USD per 1M tokens). Update if rates change.
# Source: https://www.anthropic.com/pricing — Sonnet 4.6 standard tier.
PRICE_INPUT_PER_MTOK = 3.00
PRICE_OUTPUT_PER_MTOK = 15.00
PRICE_CACHE_WRITE_PER_MTOK = 3.75
PRICE_CACHE_READ_PER_MTOK = 0.30


@dataclass
class _CallMetrics:
    input_tokens: int
    output_tokens: int
    cache_creation_tokens: int
    cache_read_tokens: int
    cost_usd: float
    wall_time_sec: float


def _compute_cost_usd(usage) -> float:
    inp = getattr(usage, "input_tokens", 0) or 0
    out = getattr(usage, "output_tokens", 0) or 0
    cwrite = getattr(usage, "cache_creation_input_tokens", 0) or 0
    cread = getattr(usage, "cache_read_input_tokens", 0) or 0
    return (
        inp / 1_000_000 * PRICE_INPUT_PER_MTOK
        + out / 1_000_000 * PRICE_OUTPUT_PER_MTOK
        + cwrite / 1_000_000 * PRICE_CACHE_WRITE_PER_MTOK
        + cread / 1_000_000 * PRICE_CACHE_READ_PER_MTOK
    )

CUTTING_SYSTEM_PROMPT = (
    "You are a video editing assistant. Given the transcript of a long-form course "
    "recording (with timestamps) and the user's instruction for how to cut it into "
    "short, social-media-ready clips, propose a list of clip boundaries.\n\n"
    "Each proposed clip should:\n"
    "- Be self-contained — open with a strong hook or setup, end at a natural\n"
    "  conclusion. Stand alone without prior context.\n"
    "- Roughly match the length the user asked for.\n"
    "- Cover meaningfully different content from the others (avoid significant\n"
    "  overlap).\n"
    "- Land near sentence boundaries — round to a clean spot.\n\n"
    "The transcript may be in any language (English, Chinese, etc.). Write "
    "each clip's title in the same language as the transcript content. Don't "
    "translate.\n\n"
    "Return your answer by calling the propose_cuts tool. Times are in seconds "
    "(floats fine).\n"
)

POLISH_SYSTEM_PROMPT = (
    "You are polishing a recording's transcript. Given a numbered word list "
    "(one word per line, prefixed by its index), identify spans the speaker "
    "said unconsciously — material a human editor would silently remove for "
    "cleaner playback.\n\n"
    "Removal-worthy categories:\n"
    "- Filler sounds: 'um', 'uh', 'er', 'ah', 'hmm', 'mm', '嗯', '呃', '啊', '唉', '呐'.\n"
    "- Filler phrases (only when used as a hedge / verbal tic, not when "
    "  semantically meaningful): 'you know', 'I mean', 'like' (as a hedge), "
    "  'sort of', 'basically', 'literally', 'actually' (as a hedge), '那个', "
    "  '就是', '然后' (as hesitation), '其实', '我觉得', '你知道'.\n"
    "- False starts: 'I- I think', 'we- we should', 'so the- the main point'.\n"
    "- Immediate repetitions: 'I I I think', '那个 那个'.\n"
    "- Drawn-out hesitations: 'aaaaand', 'soooo', '嗯——'.\n\n"
    "Be conservative. Only mark spans that are clearly speaker noise — not "
    "deliberate emphasis, not meaningful pauses, not real uses of the words "
    "above ('do you know him?' is a real question; 'actually, the answer is "
    "yes' is real emphasis). When in doubt, leave it in. Each range should be "
    "tight: just the noise, not the surrounding meaningful words.\n\n"
    "Return word-index ranges via the propose_polish_cuts tool. Both indices "
    "are inclusive."
)

POLISH_TOOL = {
    "name": "propose_polish_cuts",
    "description": "Submit word-index ranges to remove (filler sounds, false starts, repeats).",
    "input_schema": {
        "type": "object",
        "properties": {
            "cuts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "from": {
                            "type": "integer",
                            "description": "Start word index (inclusive).",
                        },
                        "to": {
                            "type": "integer",
                            "description": "End word index (inclusive).",
                        },
                        "reason": {
                            "type": "string",
                            "enum": ["filler", "repeat"],
                            "description": (
                                "filler = hesitation/verbal-tic; "
                                "repeat = false start or immediate repetition."
                            ),
                        },
                    },
                    "required": ["from", "to", "reason"],
                },
            }
        },
        "required": ["cuts"],
    },
}


CUTTING_TOOL = {
    "name": "propose_cuts",
    "description": "Submit the proposed clip boundaries.",
    "input_schema": {
        "type": "object",
        "properties": {
            "cuts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "start_sec": {
                            "type": "number",
                            "description": "Start, in seconds from the beginning of the source.",
                        },
                        "end_sec": {
                            "type": "number",
                            "description": "End, in seconds from the beginning of the source.",
                        },
                        "title": {
                            "type": "string",
                            "description": "Short clip title (under 60 characters).",
                        },
                    },
                    "required": ["start_sec", "end_sec", "title"],
                },
            }
        },
        "required": ["cuts"],
    },
}


class ClaudeProvider(LlmProvider):
    def __init__(self, api_key: str, model: str = "claude-sonnet-4-6"):
        self.client = AsyncAnthropic(api_key=api_key)
        self.model = model

    async def propose_cuts(
        self,
        transcript_segments: list[dict],
        cutting_prompt: str,
        source_duration_sec: float,
    ) -> list[Cut]:
        if source_duration_sec <= CHUNK_THRESHOLD_SEC:
            cuts, m = await self._call_single(
                transcript_segments, cutting_prompt, source_duration_sec, chunk_window=None
            )
            log.info(
                "cut: 1 call, %d in (%d cache_read, %d cache_write), %d out, "
                "$%.4f, %.1fs → %d cuts",
                m.input_tokens, m.cache_read_tokens, m.cache_creation_tokens,
                m.output_tokens, m.cost_usd, m.wall_time_sec, len(cuts),
            )
            return cuts
        return await self._call_chunked(
            transcript_segments, cutting_prompt, source_duration_sec
        )

    async def _call_chunked(
        self,
        transcript_segments: list[dict],
        cutting_prompt: str,
        source_duration_sec: float,
    ) -> list[Cut]:
        windows: list[tuple[float, float]] = []
        anchor = 0.0
        while anchor < source_duration_sec:
            anchor_end = min(source_duration_sec, anchor + CHUNK_DURATION_SEC)
            win_start = max(0.0, anchor - CHUNK_OVERLAP_SEC)
            win_end = min(source_duration_sec, anchor_end + CHUNK_OVERLAP_SEC)
            windows.append((win_start, win_end))
            anchor = anchor_end

        log.info(
            "cut: chunked %.0fs source into %d windows "
            "(%.0fs anchor + %.0fs overlap each side)",
            source_duration_sec,
            len(windows),
            CHUNK_DURATION_SEC,
            CHUNK_OVERLAP_SEC,
        )

        chunk_t0 = time.monotonic()

        async def call_one(idx: int, win: tuple[float, float]) -> tuple[list[Cut], _CallMetrics]:
            ws, we = win
            window_segs = [
                s for s in transcript_segments if s["end"] > ws and s["start"] < we
            ]
            cuts, m = await self._call_single(
                window_segs, cutting_prompt, source_duration_sec, chunk_window=win
            )
            log.info(
                "  chunk %d/%d [%.0f-%.0fs]: %d in (%d cache_read), %d out, "
                "$%.4f, %.1fs → %d cuts",
                idx + 1, len(windows), ws, we,
                m.input_tokens, m.cache_read_tokens, m.output_tokens,
                m.cost_usd, m.wall_time_sec, len(cuts),
            )
            return cuts, m

        results = await asyncio.gather(
            *(call_one(i, w) for i, w in enumerate(windows))
        )

        all_cuts: list[Cut] = []
        total_in = total_out = total_cwrite = total_cread = 0
        total_cost = 0.0
        for cuts, m in results:
            all_cuts.extend(cuts)
            total_in += m.input_tokens
            total_out += m.output_tokens
            total_cwrite += m.cache_creation_tokens
            total_cread += m.cache_read_tokens
            total_cost += m.cost_usd

        deduped = dedupe_cuts(all_cuts)
        log.info(
            "cut total: %d calls, %d in (%d cache_read, %d cache_write), %d out, "
            "$%.4f, %.1fs wall → %d cuts (%d after dedup)",
            len(windows), total_in, total_cread, total_cwrite, total_out,
            total_cost, time.monotonic() - chunk_t0,
            len(all_cuts), len(deduped),
        )
        return deduped

    async def _call_single(
        self,
        transcript_segments: list[dict],
        cutting_prompt: str,
        source_duration_sec: float,
        chunk_window: tuple[float, float] | None,
    ) -> tuple[list[Cut], _CallMetrics]:
        transcript_text = "\n".join(
            f"[{seg['start']:.1f}s - {seg['end']:.1f}s] {seg['text'].strip()}"
            for seg in transcript_segments
        )

        if chunk_window is not None:
            cs, ce = chunk_window
            window_note = (
                f"This is one excerpt of a longer source. It covers seconds {cs:.1f}–{ce:.1f} "
                f"of the full {source_duration_sec:.1f}-second recording. Propose cuts that "
                f"fall within this excerpt's window. Use absolute source-time in the output, "
                f"not chunk-relative time. Other excerpts cover other parts of the source — "
                f"don't try to cover content outside this window.\n\n"
            )
        else:
            window_note = ""

        user_msg = (
            f"Source duration: {source_duration_sec:.1f} seconds.\n\n"
            f"{window_note}"
            f"User's cutting instruction:\n{cutting_prompt}\n\n"
            f"Transcript (segment-level timestamps):\n{transcript_text}\n\n"
            "Return clip boundaries via the propose_cuts tool."
        )

        t0 = time.monotonic()
        # 16k headroom: Claude Sonnet supports plenty more, and the
        # JSON-string-wrapping quirk roughly doubles output tokens —
        # 8k was empirically truncating long-source cut lists.
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=16384,
            system=[
                {
                    "type": "text",
                    "text": CUTTING_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_msg}],
            tools=[CUTTING_TOOL],
            tool_choice={"type": "tool", "name": "propose_cuts"},
        )
        elapsed = time.monotonic() - t0

        usage = response.usage
        metrics = _CallMetrics(
            input_tokens=getattr(usage, "input_tokens", 0) or 0,
            output_tokens=getattr(usage, "output_tokens", 0) or 0,
            cache_creation_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
            cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
            cost_usd=_compute_cost_usd(usage),
            wall_time_sec=elapsed,
        )

        for block in response.content:
            if block.type == "tool_use" and block.name == "propose_cuts":
                cuts_raw = block.input.get("cuts", [])
                # Claude occasionally serializes the array as a JSON-string
                # rather than an actual list — and that string-wrapped
                # form is roughly 2x more output tokens (every '"' becomes
                # '\\"', etc.), which means it can hit max_tokens and arrive
                # truncated. parse_json_array_partial salvages the complete
                # objects so we ship the cuts that did make it instead of
                # failing the whole pipeline.
                if isinstance(cuts_raw, str):
                    raw_text = cuts_raw
                    try:
                        cuts_raw = json.loads(raw_text)
                    except json.JSONDecodeError as e:
                        cuts_raw = parse_json_array_partial(raw_text)
                        if not cuts_raw:
                            raise RuntimeError(
                                f"Claude returned cuts as an unrecoverable "
                                f"string: {raw_text[:200]!r}"
                            ) from e
                        log.warning(
                            "Claude returned cuts as a JSON string and was "
                            "truncated by max_tokens; recovered %d complete "
                            "cut(s) from the partial output.",
                            len(cuts_raw),
                        )
                if not isinstance(cuts_raw, list):
                    raise RuntimeError(
                        f"Claude returned cuts of unexpected type "
                        f"{type(cuts_raw).__name__}: {cuts_raw!r}"
                    )
                if response.stop_reason == "max_tokens":
                    log.warning(
                        "Claude propose_cuts hit max_tokens (output=%d) — "
                        "consider raising the limit; got %d cut(s).",
                        response.usage.output_tokens,
                        len(cuts_raw),
                    )
                out: list[Cut] = []
                for c in cuts_raw:
                    if not isinstance(c, dict):
                        log.warning(
                            "Claude returned non-dict cut entry %r — skipping", c
                        )
                        continue
                    start = max(0.0, float(c["start_sec"]))
                    end = min(source_duration_sec, float(c["end_sec"]))
                    if end - start < 1.0:
                        continue
                    out.append(
                        Cut(start_sec=start, end_sec=end, title=str(c["title"])[:120])
                    )
                return out, metrics

        raise RuntimeError("Claude returned no propose_cuts tool_use block")

    async def propose_polish_cuts(
        self,
        transcript_segments: list[dict],
        language: str | None,
    ) -> list[PolishCut]:
        words = flatten_words(transcript_segments)
        if not words:
            log.info("polish: no word-level data on transcript — skipping")
            return []
        word_text = render_word_list(words)
        user_msg = (
            f"Word list ({len(words)} words, format `idx: word`):\n{word_text}\n\n"
            "Identify all spans worth removing via the propose_polish_cuts "
            "tool. Stay conservative — only mark clear speaker noise."
        )
        t0 = time.monotonic()
        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=[
                    {
                        "type": "text",
                        "text": POLISH_SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_msg}],
                tools=[POLISH_TOOL],
                tool_choice={"type": "tool", "name": "propose_polish_cuts"},
            )
        except Exception as e:
            log.warning("polish: Claude call failed (%s) — skipping filler cuts", e)
            return []
        elapsed = time.monotonic() - t0
        usage = response.usage
        cost = _compute_cost_usd(usage)
        for block in response.content:
            if block.type == "tool_use" and block.name == "propose_polish_cuts":
                raw = block.input.get("cuts", [])
                if isinstance(raw, str):
                    try:
                        raw = json.loads(raw)
                    except json.JSONDecodeError:
                        log.warning("polish: Claude wrapped cuts as string and failed reparse")
                        return []
                if not isinstance(raw, list):
                    log.warning(
                        "polish: Claude returned cuts of type %s — dropping",
                        type(raw).__name__,
                    )
                    return []
                cuts = polish_cuts_from_index_ranges(words, raw)
                log.info(
                    "polish: 1 call, %d in (%d cache_read, %d cache_write), %d out, "
                    "$%.4f, %.1fs → %d filler cuts (%d words; lang=%r)",
                    getattr(usage, "input_tokens", 0) or 0,
                    getattr(usage, "cache_read_input_tokens", 0) or 0,
                    getattr(usage, "cache_creation_input_tokens", 0) or 0,
                    getattr(usage, "output_tokens", 0) or 0,
                    cost,
                    elapsed,
                    len(cuts),
                    len(words),
                    language,
                )
                return cuts
        log.warning("polish: Claude returned no propose_polish_cuts tool_use block")
        return []
