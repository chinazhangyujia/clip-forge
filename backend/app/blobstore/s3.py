"""S3-backed BlobStore (production profile) — STUB.

For real production use this would wrap boto3 / aioboto3, with a local cache
directory under `local_path()` so ffmpeg / Whisper can still operate on real
files (downloading on first access, uploading on close / explicit upload).

Until then any attempt to use it raises NotImplementedError on init.
"""

from __future__ import annotations

from collections.abc import AsyncIterable
from pathlib import Path

from .base import BlobStore

_NI = "S3BlobStore is a stub — implement before enabling the prod profile."


class S3BlobStore(BlobStore):
    def __init__(self, bucket: str):
        self.bucket = bucket

    async def init(self) -> None:
        raise NotImplementedError(_NI)

    async def close(self) -> None:
        return None

    async def upload_stream(self, key: str, chunks: AsyncIterable[bytes]) -> int:
        raise NotImplementedError(_NI)

    async def write_text(self, key: str, content: str) -> None:
        raise NotImplementedError(_NI)

    async def read_text(self, key: str) -> str:
        raise NotImplementedError(_NI)

    async def exists(self, key: str) -> bool:
        raise NotImplementedError(_NI)

    async def delete_prefix(self, prefix: str) -> None:
        raise NotImplementedError(_NI)

    async def list_keys(self, prefix: str) -> list[str]:
        raise NotImplementedError(_NI)

    def local_path(self, key: str) -> Path:
        raise NotImplementedError(_NI)
