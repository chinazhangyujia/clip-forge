import asyncio
import logging
import time
from dataclasses import dataclass

from anthropic import AsyncAnthropic

from .base import Cut, LlmProvider

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
DEDUP_PROXIMITY_SEC = 5.0

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

        deduped = _dedupe_cuts(all_cuts)
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
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=8192,
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
                out: list[Cut] = []
                for c in cuts_raw:
                    start = max(0.0, float(c["start_sec"]))
                    end = min(source_duration_sec, float(c["end_sec"]))
                    if end - start < 1.0:
                        continue
                    out.append(
                        Cut(start_sec=start, end_sec=end, title=str(c["title"])[:120])
                    )
                return out, metrics

        raise RuntimeError("Claude returned no propose_cuts tool_use block")


def _dedupe_cuts(cuts: list[Cut]) -> list[Cut]:
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
