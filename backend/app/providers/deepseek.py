"""DeepSeek implementation of the LlmProvider interface.

DeepSeek's REST API is OpenAI-compatible (POST /chat/completions, OpenAI-style
function calling), so we reuse the openai SDK by pointing it at
api.deepseek.com. The system prompt and user-message wrapper are written in
Chinese — this provider is targeted at the China-prod profile where prompts
and transcripts will be Chinese.

Reference: https://api-docs.deepseek.com/api/create-chat-completion
"""

import asyncio
import json
import logging
import time
from dataclasses import dataclass

from openai import AsyncOpenAI

from .base import (
    Cut,
    LlmProvider,
    PolishCut,
    dedupe_cuts,
    flatten_words,
    parse_cuts_from_malformed_arguments,
    parse_json_array_partial,
    polish_cuts_from_index_ranges,
    render_word_list,
)

log = logging.getLogger(__name__)

DEEPSEEK_BASE_URL = "https://api.deepseek.com"

# Map-reduce thresholds — same shape as the Claude provider so behavior stays
# substitutable. DeepSeek's 1M-token context can technically hold a much
# longer transcript in one shot, but chunking still helps because (a) max
# output is bounded and a long source produces many cuts, and (b) parallel
# chunk calls are wall-clock faster than one giant call.
CHUNK_THRESHOLD_SEC = 45 * 60
CHUNK_DURATION_SEC = 30 * 60
CHUNK_OVERLAP_SEC = 2 * 60

# DeepSeek pricing (USD per 1M tokens) for deepseek-v4-flash, our default.
# Source: https://api-docs.deepseek.com/quick_start/pricing — update if rates
# change or if you switch the configured model to deepseek-v4-pro (which is
# roughly 3× more expensive at non-discount pricing).
PRICE_CACHE_HIT_PER_MTOK = 0.0028
PRICE_CACHE_MISS_PER_MTOK = 0.14
PRICE_OUTPUT_PER_MTOK = 0.28

# 提示词使用中文,因为 China-prod 配置下的视频内容和用户指令都是中文。
CUTTING_SYSTEM_PROMPT = (
    "你是一名视频剪辑助手。给定一段长视频课程录像的转录文稿(带时间戳),以及用户关于"
    "如何将其切成适合社交媒体短视频的剪辑指示,请提出一组剪辑片段的时间边界。\n\n"
    "每个剪辑片段应满足:\n"
    "- 自成一体——以有力的开场或铺垫起,至自然的结论收尾。脱离前后文也能独立观看。\n"
    "- 大致符合用户要求的时长。\n"
    "- 与其他片段在内容上有明显的差异(避免明显重叠)。\n"
    "- 落在自然的句子边界——选择一个干净利落的切分点。\n\n"
    "转录文本可能是任何语言(中文、英文等)。每个片段的标题请使用与转录内容相同的语言"
    "书写,不要翻译。\n\n"
    "请通过调用 propose_cuts 工具返回你的答案。时间以秒为单位(小数也可)。\n"
)

POLISH_SYSTEM_PROMPT_ZH = (
    "你正在为一段录音的逐字稿做润色。给你一份编号的词语列表(带索引),请找出"
    "讲话人在无意识中说出、人工剪辑师会悄悄移除以让播放更干净的片段。\n\n"
    "可移除的类别:\n"
    "- 语气词/填充音:\"嗯\"、\"呃\"、\"啊\"、\"唉\"、\"呐\"、"
    "\"um\"、\"uh\"、\"er\"、\"ah\"、\"hmm\"、\"mm\" 等。\n"
    "- 填充短语(只有当它们明显是口头禅,而不是承担实际语义时):\"那个\"、"
    "\"就是\"、\"然后\"、\"其实\"、\"你知道\"、\"我觉得\"、\"like\"、\"you know\"、"
    "\"I mean\"、\"basically\"、\"literally\" 等。\n"
    "- 假开头(说话人重新组织语言时的小重启):\"我- 我觉得\"、\"我们- 我们应该\"。\n"
    "- 紧邻的重复:\"我我我觉得\"、\"那个那个\"。\n"
    "- 拖长的犹豫:\"嗯——\"、\"那——个\"、\"soooo\"。\n\n"
    "请非常保守。只标记明显是口语噪声的范围——不要剪掉刻意的停顿、强调、或者"
    "上面这些词的真实用法(例如\"你知道吗?\"中的\"你知道\"是真问句,不应剪)。"
    "拿不准的就保留。每个范围要紧贴噪声本身,不要包含周围有实际意义的词。\n\n"
    "请通过 propose_polish_cuts 工具按词索引返回范围(from/to 都是闭区间)。"
)

POLISH_TOOL = {
    "type": "function",
    "function": {
        "name": "propose_polish_cuts",
        "description": "提交需要从录音中剪掉的词索引范围(口头禅、假开头、重复等)。",
        "parameters": {
            "type": "object",
            "properties": {
                "cuts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "from": {
                                "type": "integer",
                                "description": "起始词索引(闭区间)。",
                            },
                            "to": {
                                "type": "integer",
                                "description": "结束词索引(闭区间)。",
                            },
                            "reason": {
                                "type": "string",
                                "enum": ["filler", "repeat"],
                                "description": "类别:filler=语气词/填充短语,repeat=重复或假开头。",
                            },
                        },
                        "required": ["from", "to", "reason"],
                    },
                }
            },
            "required": ["cuts"],
        },
    },
}


CUTTING_TOOL = {
    "type": "function",
    "function": {
        "name": "propose_cuts",
        "description": "提交所提出的剪辑片段时间边界。",
        "parameters": {
            "type": "object",
            "properties": {
                "cuts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "start_sec": {
                                "type": "number",
                                "description": "起始时间,从源视频开头算起的秒数。",
                            },
                            "end_sec": {
                                "type": "number",
                                "description": "结束时间,从源视频开头算起的秒数。",
                            },
                            "title": {
                                "type": "string",
                                "description": "剪辑片段标题(不超过 60 个字符)。",
                            },
                        },
                        "required": ["start_sec", "end_sec", "title"],
                    },
                }
            },
            "required": ["cuts"],
        },
    },
}


@dataclass
class _CallMetrics:
    input_tokens: int
    output_tokens: int
    cache_hit_tokens: int
    cache_miss_tokens: int
    cost_usd: float
    wall_time_sec: float


def _compute_cost_usd(usage) -> float:
    # DeepSeek splits prompt tokens into hit / miss buckets in the response.
    # The miss bucket is billed at the regular input rate; the hit bucket is
    # billed at the much-cheaper cache rate. There's no separate "cache write"
    # cost like Anthropic has — caching is automatic.
    hit = getattr(usage, "prompt_cache_hit_tokens", 0) or 0
    miss = getattr(usage, "prompt_cache_miss_tokens", 0) or 0
    out = getattr(usage, "completion_tokens", 0) or 0
    return (
        hit / 1_000_000 * PRICE_CACHE_HIT_PER_MTOK
        + miss / 1_000_000 * PRICE_CACHE_MISS_PER_MTOK
        + out / 1_000_000 * PRICE_OUTPUT_PER_MTOK
    )


class DeepSeekProvider(LlmProvider):
    def __init__(self, api_key: str, model: str = "deepseek-v4-flash"):
        self.client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
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
                "cut: 1 call, %d in (%d cache_hit, %d cache_miss), %d out, "
                "$%.4f, %.1fs → %d cuts",
                m.input_tokens, m.cache_hit_tokens, m.cache_miss_tokens,
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
                "  chunk %d/%d [%.0f-%.0fs]: %d in (%d cache_hit), %d out, "
                "$%.4f, %.1fs → %d cuts",
                idx + 1, len(windows), ws, we,
                m.input_tokens, m.cache_hit_tokens, m.output_tokens,
                m.cost_usd, m.wall_time_sec, len(cuts),
            )
            return cuts, m

        results = await asyncio.gather(
            *(call_one(i, w) for i, w in enumerate(windows))
        )

        all_cuts: list[Cut] = []
        total_in = total_out = total_hit = total_miss = 0
        total_cost = 0.0
        for cuts, m in results:
            all_cuts.extend(cuts)
            total_in += m.input_tokens
            total_out += m.output_tokens
            total_hit += m.cache_hit_tokens
            total_miss += m.cache_miss_tokens
            total_cost += m.cost_usd

        deduped = dedupe_cuts(all_cuts)
        log.info(
            "cut total: %d calls, %d in (%d cache_hit, %d cache_miss), %d out, "
            "$%.4f, %.1fs wall → %d cuts (%d after dedup)",
            len(windows), total_in, total_hit, total_miss, total_out,
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
                f"这是一段更长视频中的某一片段,覆盖整段 {source_duration_sec:.1f} 秒"
                f"录像中的第 {cs:.1f}–{ce:.1f} 秒。请仅在该窗口内提出剪辑边界,并使用"
                f"相对于源视频的绝对时间(不要使用相对于本片段的时间)。其他片段会覆盖"
                f"源视频的其他部分——请不要尝试覆盖本窗口之外的内容。\n\n"
            )
        else:
            window_note = ""

        user_msg = (
            f"源视频时长:{source_duration_sec:.1f} 秒。\n\n"
            f"{window_note}"
            f"用户的剪辑指示:\n{cutting_prompt}\n\n"
            f"转录文稿(按片段时间戳):\n{transcript_text}\n\n"
            "请通过 propose_cuts 工具返回剪辑片段的时间边界。"
        )

        t0 = time.monotonic()
        # Disable thinking explicitly: deepseek-v4-flash defaults to thinking
        # mode, which routes through the reasoner backend and rejects
        # specific-function tool_choice with "deepseek-reasoner does not
        # support this tool_choice". We don't need CoT for this task — just
        # extract cut boundaries from the transcript and emit them as JSON.
        response = await self.client.chat.completions.create(
            model=self.model,
            max_tokens=8192,
            messages=[
                {"role": "system", "content": CUTTING_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            tools=[CUTTING_TOOL],
            tool_choice={"type": "function", "function": {"name": "propose_cuts"}},
            extra_body={"thinking": {"type": "disabled"}},
        )
        elapsed = time.monotonic() - t0

        usage = response.usage
        metrics = _CallMetrics(
            input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            output_tokens=getattr(usage, "completion_tokens", 0) or 0,
            cache_hit_tokens=getattr(usage, "prompt_cache_hit_tokens", 0) or 0,
            cache_miss_tokens=getattr(usage, "prompt_cache_miss_tokens", 0) or 0,
            cost_usd=_compute_cost_usd(usage),
            wall_time_sec=elapsed,
        )

        message = response.choices[0].message
        for call in message.tool_calls or []:
            if call.function.name != "propose_cuts":
                continue
            raw_args = call.function.arguments
            try:
                payload = json.loads(raw_args)
                cuts_raw = payload.get("cuts", [])
            except json.JSONDecodeError as e:
                # The arguments string itself is malformed — usually a
                # missing comma, an unescaped quote in a title, or a
                # truncated stream. Salvage complete cut objects via
                # the partial parser instead of failing the pipeline.
                cuts_raw = parse_cuts_from_malformed_arguments(raw_args)
                if not cuts_raw:
                    finish = response.choices[0].finish_reason
                    raise RuntimeError(
                        f"DeepSeek returned malformed propose_cuts "
                        f"arguments ({e}; finish_reason={finish!r}, "
                        f"len={len(raw_args)}). Head: {raw_args[:200]!r}"
                    ) from e
                log.warning(
                    "DeepSeek tool-call arguments failed to parse (%s); "
                    "recovered %d complete cut(s) from partial output.",
                    e, len(cuts_raw),
                )
            if isinstance(cuts_raw, str):
                # Some models nest the array as a JSON-encoded string,
                # which roughly doubles output tokens (every '"' becomes
                # '\\"'); a truncated wrap leaves us with a malformed
                # JSON string. parse_json_array_partial salvages the
                # complete cuts so we ship them rather than failing.
                raw_text = cuts_raw
                try:
                    cuts_raw = json.loads(raw_text)
                except json.JSONDecodeError as e:
                    cuts_raw = parse_json_array_partial(raw_text)
                    if not cuts_raw:
                        raise RuntimeError(
                            f"DeepSeek returned cuts as an unrecoverable "
                            f"string: {raw_text[:200]!r}"
                        ) from e
                    log.warning(
                        "DeepSeek returned cuts as a JSON string and was "
                        "truncated by max_tokens; recovered %d complete "
                        "cut(s) from the partial output.",
                        len(cuts_raw),
                    )
            if not isinstance(cuts_raw, list):
                raise RuntimeError(
                    f"DeepSeek returned cuts of unexpected type "
                    f"{type(cuts_raw).__name__}: {cuts_raw!r}"
                )
            if response.choices[0].finish_reason == "length":
                log.warning(
                    "DeepSeek propose_cuts hit max_tokens — output may be "
                    "incomplete; got %d cut(s).",
                    len(cuts_raw),
                )
            out: list[Cut] = []
            for c in cuts_raw:
                if not isinstance(c, dict):
                    log.warning(
                        "DeepSeek returned non-dict cut entry %r — skipping", c
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

        raise RuntimeError("DeepSeek returned no propose_cuts tool call")

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
            f"逐字稿(共 {len(words)} 个词,格式: 索引: 词):\n{word_text}\n\n"
            "请通过 propose_polish_cuts 工具返回所有需要剪掉的词索引范围。"
            "记住要保守——只标记明显是口语噪声的部分。"
        )
        t0 = time.monotonic()
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                max_tokens=4096,
                messages=[
                    {"role": "system", "content": POLISH_SYSTEM_PROMPT_ZH},
                    {"role": "user", "content": user_msg},
                ],
                tools=[POLISH_TOOL],
                tool_choice={
                    "type": "function",
                    "function": {"name": "propose_polish_cuts"},
                },
                extra_body={"thinking": {"type": "disabled"}},
            )
        except Exception as e:
            log.warning("polish: DeepSeek call failed (%s) — skipping filler cuts", e)
            return []
        elapsed = time.monotonic() - t0
        usage = response.usage
        cost = _compute_cost_usd(usage)
        message = response.choices[0].message
        for call in message.tool_calls or []:
            if call.function.name != "propose_polish_cuts":
                continue
            try:
                payload = json.loads(call.function.arguments)
            except json.JSONDecodeError as e:
                log.warning("polish: DeepSeek returned non-JSON arguments (%s)", e)
                return []
            raw = payload.get("cuts", [])
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except json.JSONDecodeError:
                    log.warning("polish: DeepSeek wrapped cuts as string and failed reparse")
                    return []
            if not isinstance(raw, list):
                log.warning(
                    "polish: DeepSeek returned cuts of type %s — dropping",
                    type(raw).__name__,
                )
                return []
            cuts = polish_cuts_from_index_ranges(words, raw)
            log.info(
                "polish: 1 call, %d in (%d cache_hit, %d cache_miss), %d out, "
                "$%.4f, %.1fs → %d filler cuts (%d words; lang=%r)",
                getattr(usage, "prompt_tokens", 0) or 0,
                getattr(usage, "prompt_cache_hit_tokens", 0) or 0,
                getattr(usage, "prompt_cache_miss_tokens", 0) or 0,
                getattr(usage, "completion_tokens", 0) or 0,
                cost,
                elapsed,
                len(cuts),
                len(words),
                language,
            )
            return cuts
        log.warning("polish: DeepSeek returned no propose_polish_cuts tool call")
        return []
