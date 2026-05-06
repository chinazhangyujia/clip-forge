from abc import ABC, abstractmethod
from dataclasses import dataclass

# Two cuts whose start times are closer than this are treated as duplicates by
# dedupe_cuts(). The chunked map-reduce path (see each provider) gives every
# anchor window a small overlap on each side, which is what produces the
# near-duplicate cuts this constant cleans up.
DEDUP_PROXIMITY_SEC = 5.0


@dataclass
class Cut:
    start_sec: float
    end_sec: float
    title: str


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
