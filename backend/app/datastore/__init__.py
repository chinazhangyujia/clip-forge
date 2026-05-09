"""Data store abstraction.

Two implementations live behind the `DataStore` interface:

- `LocalFileDataStore` — JSON-file backed, used in local dev. Tables are
  written under `<workspace>/db/{projects,clips,jobs}.json`.
- `PostgresDataStore` — relational store for production. Stub for now;
  fill in when the prod profile is activated.

The active implementation is chosen by the `CLIPFORGE_DATASTORE` env var
(default: `local`).
"""

from __future__ import annotations

import os

from .base import ClipInterval, ClipRow, DataStore, JobRow, ProjectRow
from .local import LocalFileDataStore
from .postgres import PostgresDataStore

_instance: DataStore | None = None


def get_datastore() -> DataStore:
    global _instance
    if _instance is None:
        profile = os.getenv("CLIPFORGE_DATASTORE", "local")
        if profile == "local":
            from ..config import settings

            _instance = LocalFileDataStore(settings.workspace_dir / "db")
        elif profile == "postgres":
            dsn = os.getenv("CLIPFORGE_POSTGRES_DSN", "")
            if not dsn:
                raise RuntimeError(
                    "CLIPFORGE_DATASTORE=postgres but CLIPFORGE_POSTGRES_DSN is not set"
                )
            _instance = PostgresDataStore(dsn)
        else:
            raise RuntimeError(f"Unknown CLIPFORGE_DATASTORE profile: {profile!r}")
    return _instance


def reset_datastore_for_tests() -> None:
    """Drop the cached datastore. Test helper."""
    global _instance
    _instance = None


__all__ = [
    "ClipInterval",
    "ClipRow",
    "DataStore",
    "JobRow",
    "LocalFileDataStore",
    "PostgresDataStore",
    "ProjectRow",
    "get_datastore",
    "reset_datastore_for_tests",
]
