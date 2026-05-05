"""BlobStore interface + key helpers.

Keys are project-scoped, slash-delimited, e.g. `p_abc/source.mp4`,
`p_abc/clips/c1.mp4`. The interface is deliberately small and S3-shaped.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterable
from pathlib import Path


class BlobStore(ABC):
    """Abstract object store for project blobs (videos, audio, transcripts, clips)."""

    @abstractmethod
    async def init(self) -> None: ...

    @abstractmethod
    async def close(self) -> None: ...

    @abstractmethod
    async def upload_stream(self, key: str, chunks: AsyncIterable[bytes]) -> int:
        """Stream-write a blob. Returns total bytes written."""

    @abstractmethod
    async def write_text(self, key: str, content: str) -> None:
        """Write a small text blob (transcript JSON, cuts JSON, etc.)."""

    @abstractmethod
    async def read_text(self, key: str) -> str: ...

    @abstractmethod
    async def exists(self, key: str) -> bool: ...

    @abstractmethod
    async def delete_prefix(self, prefix: str) -> None:
        """Delete every blob whose key starts with `prefix`."""

    @abstractmethod
    async def list_keys(self, prefix: str) -> list[str]:
        """List all keys starting with `prefix`."""

    @abstractmethod
    def local_path(self, key: str) -> Path:
        """Return a local-filesystem path the blob is readable / writable from.

        Used by ffmpeg / Whisper which need real files. The local impl returns
        the actual file path (and ensures parent dirs exist on access). The
        S3 impl downloads on demand to a cache directory and returns the
        cached path.
        """


# ---------- key helpers ----------

def source_key(project_id: str, ext: str) -> str:
    if not ext.startswith("."):
        ext = "." + ext if ext else ""
    return f"{project_id}/source{ext}"


def audio_key(project_id: str) -> str:
    return f"{project_id}/audio.wav"


def transcript_key(project_id: str) -> str:
    return f"{project_id}/transcript.json"


def cuts_key(project_id: str) -> str:
    return f"{project_id}/cuts.json"


def clip_key(project_id: str, clip_id: str) -> str:
    return f"{project_id}/clips/{clip_id}.mp4"


def project_prefix(project_id: str) -> str:
    return f"{project_id}/"
