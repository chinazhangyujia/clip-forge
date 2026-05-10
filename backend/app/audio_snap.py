"""Find true silence boundaries inside known-pause gaps.

Whisper's word-level timestamps come from cross-attention alignment and
sometimes underestimate the actual end of phonation by 100–500ms — most
visibly on Chinese tone-3 syllables and other words with sustained
voiced decay. The transcript-driven heuristic in `silence.py` adds a
fixed amount of breath padding to compensate, but it can't catch the
worst cases without making every cut feel slow.

This module solves that with a *within-gap relative* energy detector:

  - We already KNOW (from Whisper) that a real pause exists between two
    consecutive transcript segments. We don't need to find pauses, only
    their precise boundaries.
  - For each gap we scan the audio's RMS energy and find the longest
    contiguous low-energy run. Its onset is where the previous word
    actually ended; its end is where the next word actually started.
  - The "low-energy" cutoff is derived from the gap's own RMS
    distribution (bottom quartile), not a global absolute threshold —
    so the detector works the same on a quiet studio and a noisy room.

The pipeline uses these refined boundaries to extend the kept audio so
the crossfade falls inside confirmed silence (no audible word tail).
The refinement is purely additive: if no silence run can be found in
the gap, the heuristic bounds stand.
"""

from __future__ import annotations

import logging
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)


# Headroom past the detected silence onset before the cut. Keeps a tiny
# slice of confirmed silence between the word's actual end and the
# crossfade region so the fade falls in silence-on-silence.
EDGE_PAD_SEC = 0.06

# RMS frame size and step. 20ms frames are short enough to localize the
# silence boundary cleanly while integrating enough samples to be
# robust to single-cycle noise.
FRAME_MS = 20
STEP_MS = 10

# Minimum silent-run length to count as "this is the silence within the
# gap". Filters out single noise dips inside speech.
MIN_SILENT_RUN_SEC = 0.10


@dataclass
class GapRefinement:
    """The audio-snap result for one pause gap."""

    silence_start: float  # source-time second the speech actually ended
    silence_end: float  # source-time second the next speech actually started


def load_pcm(audio_path: Path) -> tuple[np.ndarray, int] | tuple[None, None]:
    """Load mono PCM as float32 in [-1, 1]. Returns (None, None) if the
    file can't be read or the format isn't supported (we extract our
    own audio.wav as 16-bit mono PCM, so the supported set is small)."""
    try:
        with wave.open(str(audio_path), "rb") as wf:
            sr = wf.getframerate()
            sampwidth = wf.getsampwidth()
            nchannels = wf.getnchannels()
            raw = wf.readframes(wf.getnframes())
    except (wave.Error, EOFError, OSError) as e:
        log.warning("audio-snap: could not open %s: %s", audio_path, e)
        return None, None

    if sampwidth == 2:
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sampwidth == 4:
        samples = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        log.warning("audio-snap: unsupported sample width %d", sampwidth)
        return None, None

    if nchannels > 1:
        samples = samples.reshape(-1, nchannels).mean(axis=1)
    return samples, sr


def _frame_rms(samples: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """Return (rms_per_frame, frame_start_offset_sec) over `samples`."""
    frame_n = int(FRAME_MS * sr / 1000)
    step_n = int(STEP_MS * sr / 1000)
    if frame_n <= 0 or step_n <= 0 or len(samples) < frame_n:
        return np.array([], dtype=np.float32), np.array([], dtype=np.float32)
    n_frames = 1 + (len(samples) - frame_n) // step_n
    starts = np.arange(n_frames) * step_n
    rms = np.empty(n_frames, dtype=np.float32)
    for i, s in enumerate(starts):
        chunk = samples[s : s + frame_n]
        rms[i] = float(np.sqrt(np.mean(chunk * chunk)))
    return rms, starts.astype(np.float32) / sr


def find_silence_in_gap(
    samples: np.ndarray,
    sr: int,
    gap_start: float,
    gap_end: float,
    pad_sec: float = 0.30,
) -> GapRefinement | None:
    """Find the silence inside a known-pause gap and return its
    source-time boundaries.

    The search window extends `pad_sec` past each gap edge so we can
    detect when the heuristic kept-audio bounds have actually bled into
    the spoken word (silence onset would land inside [gap_start - pad,
    gap_start]).

    Returns None when:
      - The gap is too short to scan (< ~150ms of usable audio).
      - The gap's RMS distribution has no clear dynamic range (whole
        window is uniformly silent or uniformly speech).
      - No silent run of `MIN_SILENT_RUN_SEC` is found.
    The caller falls back to the heuristic bounds in those cases.
    """
    if samples.size == 0 or sr <= 0:
        return None

    win_start = max(0.0, gap_start - pad_sec)
    win_end = min(len(samples) / sr, gap_end + pad_sec)
    if win_end - win_start < 0.15:
        return None

    s_idx = int(win_start * sr)
    e_idx = int(win_end * sr)
    rms, frame_offsets = _frame_rms(samples[s_idx:e_idx], sr)
    if rms.size < 5:
        return None

    # Within-gap relative threshold. p25 is roughly the silence floor,
    # p75 the speech ceiling, in this window. If the spread is tiny,
    # the window doesn't contain a real speech↔silence transition.
    p25 = float(np.percentile(rms, 25))
    p75 = float(np.percentile(rms, 75))
    if p75 - p25 < 0.005:
        return None
    threshold = p25 + (p75 - p25) * 0.25

    silent = rms < threshold
    min_silent_frames = max(1, int(MIN_SILENT_RUN_SEC * 1000 / STEP_MS))

    # Longest contiguous silent run.
    best_start = best_end = -1
    cur_start = -1
    for i, is_silent in enumerate(silent):
        if is_silent:
            if cur_start < 0:
                cur_start = i
        else:
            if cur_start >= 0:
                run_len = i - cur_start
                if run_len > (best_end - best_start):
                    best_start, best_end = cur_start, i
                cur_start = -1
    if cur_start >= 0:
        run_len = len(silent) - cur_start
        if run_len > (best_end - best_start):
            best_start, best_end = cur_start, len(silent)

    if best_start < 0 or (best_end - best_start) < min_silent_frames:
        return None

    silence_start = win_start + float(frame_offsets[best_start])
    last_idx = min(best_end - 1, len(frame_offsets) - 1)
    silence_end = win_start + float(frame_offsets[last_idx]) + (FRAME_MS / 1000.0)

    if silence_end <= silence_start:
        return None
    return GapRefinement(silence_start=silence_start, silence_end=silence_end)
