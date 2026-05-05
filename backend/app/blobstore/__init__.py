"""Blob store abstraction.

Two implementations live behind the `BlobStore` interface:

- `LocalFileBlobStore` — files on local disk under the workspace directory.
  Used in dev. `local_path()` returns the actual file path so ffmpeg /
  Whisper can read it directly.
- `S3BlobStore` — S3 (or compatible) object store for production. Stub for
  now; downloads to a local cache dir for tools that need a real path.

The active implementation is chosen by the `CLIPFORGE_BLOBSTORE` env var
(default: `local`).
"""

from __future__ import annotations

import os

from .base import (
    BlobStore,
    audio_key,
    clip_key,
    cuts_key,
    project_prefix,
    source_key,
    transcript_key,
)
from .local import LocalFileBlobStore
from .s3 import S3BlobStore

_instance: BlobStore | None = None


def get_blobstore() -> BlobStore:
    global _instance
    if _instance is None:
        profile = os.getenv("CLIPFORGE_BLOBSTORE", "local")
        if profile == "local":
            from ..config import settings

            _instance = LocalFileBlobStore(settings.workspace_dir)
        elif profile == "s3":
            bucket = os.getenv("CLIPFORGE_S3_BUCKET", "")
            if not bucket:
                raise RuntimeError(
                    "CLIPFORGE_BLOBSTORE=s3 but CLIPFORGE_S3_BUCKET is not set"
                )
            _instance = S3BlobStore(bucket)
        else:
            raise RuntimeError(f"Unknown CLIPFORGE_BLOBSTORE profile: {profile!r}")
    return _instance


def reset_blobstore_for_tests() -> None:
    global _instance
    _instance = None


__all__ = [
    "BlobStore",
    "LocalFileBlobStore",
    "S3BlobStore",
    "audio_key",
    "clip_key",
    "cuts_key",
    "get_blobstore",
    "project_prefix",
    "reset_blobstore_for_tests",
    "source_key",
    "transcript_key",
]
