"""Vertical reframe (9:16) with instructor tracking.

Pipeline for one clip:

  1. Sample frames at SAMPLE_FPS along the clip's source-time intervals.
  2. Detect frontal face per sample (OpenCV Haar cascade, picks the
     largest face if more than one). When detection fails, carry the
     previous sample forward so the trajectory has no gaps.
  3. Exponentially smooth the (cx, cy) trajectory so the virtual camera
     doesn't jitter from frame-to-frame detection noise.
  4. Re-express each sample's source time as compact time (the time it
     will live at in the silence-removed concat output).
  5. Emit a piecewise-linear ffmpeg crop expression in compact time,
     fed to the existing multi-interval render after concat.

Spec (requirements.md feature 3) calls for YOLOv8 / MediaPipe + Kalman.
For v1 we use Haar + exponential smoothing — works for talking-head
course videos (the primary content type), keeps the installer ~50 MB
smaller, and the smoothing-vs-jitter knob is in one place when we want
to swap in a fancier detector.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import cv2

log = logging.getLogger(__name__)

# Tuning knobs. Values picked for course-video material; revisit if we
# ever support fast-moving subjects.
SAMPLE_FPS = 2.0  # detection samples per source second
SMOOTHING_ALPHA = 0.25  # exponential smoothing factor (lower = smoother)
HAAR_CASCADE = "haarcascade_frontalface_default.xml"
MIN_FACE_FRAC = 0.04  # ignore faces smaller than this fraction of frame height
TARGET_W = 1080  # final output width
TARGET_H = 1920  # final output height (9:16)


@dataclass
class FaceSample:
    compact_t: float  # output time (= source time minus removed-silence)
    cx: float  # source-pixel face center x
    cy: float  # source-pixel face center y


def _load_cascade() -> cv2.CascadeClassifier:
    path = Path(cv2.data.haarcascades) / HAAR_CASCADE
    cascade = cv2.CascadeClassifier(str(path))
    if cascade.empty():
        raise RuntimeError(f"Failed to load Haar cascade at {path}")
    return cascade


def _detect_largest_face(
    frame_bgr, cascade: cv2.CascadeClassifier, fh: int
) -> tuple[float, float] | None:
    """Return the center (x, y) in source pixels of the largest detected
    face, or None if no face passes the size filter."""
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(int(fh * MIN_FACE_FRAC), int(fh * MIN_FACE_FRAC)),
    )
    if len(faces) == 0:
        return None
    # Pick the largest face — assume the dominant speaker.
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
    return (x + w / 2, y + h / 2)


def detect_face_trajectory(
    src_path: Path,
    intervals: list[tuple[float, float]],
    sample_fps: float = SAMPLE_FPS,
) -> tuple[list[FaceSample], int, int]:
    """Walk the clip's source-time intervals at sample_fps, detect a
    face per sample, and return:

      - samples: list of FaceSample in compact-time order
      - frame_w, frame_h: source video dimensions (for crop math)

    When detection misses a frame we carry the previous (cx, cy) forward
    so the smoothing pass has no gaps. If no frame in the entire clip has
    a detectable face, the returned list is empty and the renderer falls
    back to a static center crop.
    """
    cap = cv2.VideoCapture(str(src_path))
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV could not open {src_path}")
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cascade = _load_cascade()

    samples: list[FaceSample] = []
    last_cx: float | None = None
    last_cy: float | None = None
    step = 1.0 / sample_fps
    compact_offset = 0.0

    for src_start, src_end in intervals:
        t = src_start
        while t < src_end:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
            ok, frame = cap.read()
            if ok:
                center = _detect_largest_face(frame, cascade, frame_h)
                if center is not None:
                    last_cx, last_cy = center
                if last_cx is not None and last_cy is not None:
                    samples.append(
                        FaceSample(
                            compact_t=compact_offset + (t - src_start),
                            cx=last_cx,
                            cy=last_cy,
                        )
                    )
            t += step
        compact_offset += src_end - src_start

    cap.release()
    return samples, frame_w, frame_h


def smooth_trajectory(
    samples: list[FaceSample], alpha: float = SMOOTHING_ALPHA
) -> list[FaceSample]:
    """Exponential moving-average smoothing on cx (and cy) so the virtual
    camera doesn't react to per-frame detection wiggles."""
    if not samples:
        return []
    out = [samples[0]]
    sx, sy = samples[0].cx, samples[0].cy
    for s in samples[1:]:
        sx = alpha * s.cx + (1 - alpha) * sx
        sy = alpha * s.cy + (1 - alpha) * sy
        out.append(FaceSample(compact_t=s.compact_t, cx=sx, cy=sy))
    return out


def build_crop_expression(
    samples: list[FaceSample], frame_w: int, frame_h: int
) -> str:
    """Build an ffmpeg `crop` filter `x=` expression that linearly
    interpolates between samples. The crop is `ih*9/16` wide × full
    height, so we only animate x. Time variable `t` inside crop refers
    to the OUTPUT (post-concat) frame's presentation time, which equals
    compact time — matches what we put in `samples`.

    Falls back to a static center expression when no samples are
    available.
    """
    crop_w = frame_h * 9 / 16
    half_w = crop_w / 2
    max_x = max(0.0, frame_w - crop_w)

    def _clamp(cx: float) -> float:
        return max(0.0, min(max_x, cx - half_w))

    if not samples:
        return f"{_clamp(frame_w / 2):.2f}"

    if len(samples) == 1:
        return f"{_clamp(samples[0].cx):.2f}"

    # Build piecewise-linear interpolation as a chain of if(cond, val, ...)
    # expressions. Each piece is `if(between(t, a, b), <interp>,` — the
    # trailing comma feeds the NEXT piece into the false branch. Final
    # fallback is the last sample's clamped x. The chain is closed by N+1
    # right parens (N pieces + the outer pre-first if).
    pieces: list[str] = []
    for i in range(len(samples) - 1):
        a = samples[i]
        b = samples[i + 1]
        if b.compact_t <= a.compact_t:
            continue
        ax = _clamp(a.cx)
        bx = _clamp(b.cx)
        seg = (
            f"if(between(t,{a.compact_t:.3f},{b.compact_t:.3f}),"
            f"{ax:.2f}+({bx:.2f}-{ax:.2f})*(t-{a.compact_t:.3f})/"
            f"({b.compact_t:.3f}-{a.compact_t:.3f}),"
        )
        pieces.append(seg)
    first_x = _clamp(samples[0].cx)
    last_x = _clamp(samples[-1].cx)
    expr = (
        f"if(lt(t,{samples[0].compact_t:.3f}),{first_x:.2f},"
        + "".join(pieces)
        + f"{last_x:.2f}"
        + ")" * (len(pieces) + 1)
    )
    return expr


def reframe_filter_suffix(
    crop_x_expr: str,
    target_w: int = TARGET_W,
    target_h: int = TARGET_H,
) -> str:
    """The filter graph fragment to append to the existing multi-interval
    concat. Crops the post-concat video stream by the moving x expression
    (full height, 9:16 aspect), then scales to the standard 9:16 output
    size that social platforms expect."""
    # `\` escapes the comma inside crop's expression argument so ffmpeg's
    # filter parser doesn't split on it.
    safe_expr = crop_x_expr.replace(",", r"\,")
    return f"crop=ih*9/16:ih:{safe_expr}:0,scale={target_w}:{target_h}"
