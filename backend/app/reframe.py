"""Vertical reframe (9:16) — simple letterbox build.

For now this is intentionally a static layout: scale the original 16:9
clip to fit the width of a 1080×1920 canvas, center it vertically, and
fill the top + bottom space with a light grey ("white with a half-
transparent overlay" — the placeholder treatment the spec calls for).

The earlier version of this module ran OpenCV face detection per
sampled frame and emitted a piecewise-linear crop expression that
followed the speaker. We pulled that out — it added an ~80 MB OpenCV
dependency and the camera-follow result wasn't a quality win for
talking-head course videos shot on tripod, where the speaker barely
moves. If we ever ship a multi-person or moving-subject use case, the
detection layer comes back behind the same `reframe_filter_suffix()`
interface.
"""

from __future__ import annotations

# Standard 9:16 social video size — matches what TikTok / Douyin / Reels
# expect.
TARGET_W = 1080
TARGET_H = 1920

# Light grey for the top/bottom placeholder area. A solid tone reads as
# "white with a faint dimming overlay"; we don't actually composite two
# layers because the renderer's output is opaque h264 anyway.
PLACEHOLDER_COLOR = "0xCCCCCC"


def reframe_filter_suffix(
    target_w: int = TARGET_W,
    target_h: int = TARGET_H,
    placeholder_color: str = PLACEHOLDER_COLOR,
) -> str:
    """Filter graph fragment to splice after the multi-interval concat.

    `force_original_aspect_ratio=decrease` shrinks the input to fit
    inside the target canvas while preserving aspect, then `pad` adds
    centered bars in the leftover space. `force_divisible_by=2` keeps
    the scaled dimensions h264-encoder-friendly (yuv420p needs even
    width and height)."""
    return (
        f"scale={target_w}:{target_h}"
        ":force_original_aspect_ratio=decrease:force_divisible_by=2"
        f",pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color={placeholder_color}"
    )
