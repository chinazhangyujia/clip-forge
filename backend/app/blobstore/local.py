"""File-based BlobStore for local dev.

Stores blobs as files under `<root>/<key>`. `local_path()` returns the actual
path so ffmpeg / Whisper can operate directly. Parent directories are created
lazily on writes and on `local_path()` access (since callers often expect to
write at that path immediately).
"""

from __future__ import annotations

import shutil
from collections.abc import AsyncIterable
from pathlib import Path

from .base import BlobStore


class LocalFileBlobStore(BlobStore):
    def __init__(self, root: Path):
        self.root = root

    async def init(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    async def close(self) -> None:
        pass

    def _path(self, key: str) -> Path:
        return self.root / key

    def local_path(self, key: str) -> Path:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    async def upload_stream(self, key: str, chunks: AsyncIterable[bytes]) -> int:
        path = self.local_path(key)
        total = 0
        with path.open("wb") as f:
            async for chunk in chunks:
                f.write(chunk)
                total += len(chunk)
        return total

    async def write_text(self, key: str, content: str) -> None:
        self.local_path(key).write_text(content, encoding="utf-8")

    async def read_text(self, key: str) -> str:
        return self._path(key).read_text(encoding="utf-8")

    async def exists(self, key: str) -> bool:
        return self._path(key).exists()

    async def delete_prefix(self, prefix: str) -> None:
        target = self._path(prefix.rstrip("/"))
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
        elif target.is_file():
            target.unlink(missing_ok=True)

    async def list_keys(self, prefix: str) -> list[str]:
        target = self._path(prefix.rstrip("/"))
        if not target.exists():
            return []
        if target.is_file():
            return [str(target.relative_to(self.root))]
        out: list[str] = []
        for p in target.rglob("*"):
            if p.is_file():
                out.append(str(p.relative_to(self.root)))
        return sorted(out)
