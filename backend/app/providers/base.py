from abc import ABC, abstractmethod
from dataclasses import dataclass


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
