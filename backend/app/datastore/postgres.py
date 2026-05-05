"""Postgres-backed DataStore (production profile) — STUB.

Wire this up via SQLAlchemy / asyncpg when activating the prod profile.
Until then any attempt to use it raises NotImplementedError on init.
"""

from __future__ import annotations

from typing import Any

from .base import ClipRow, DataStore, JobRow, ProjectRow

_NI = "PostgresDataStore is a stub — implement before enabling the prod profile."


class PostgresDataStore(DataStore):
    def __init__(self, dsn: str):
        self.dsn = dsn

    async def init(self) -> None:
        raise NotImplementedError(_NI)

    async def close(self) -> None:
        return None

    async def insert_project(self, project: ProjectRow) -> None:
        raise NotImplementedError(_NI)

    async def get_project(self, project_id: str) -> ProjectRow | None:
        raise NotImplementedError(_NI)

    async def list_projects(self) -> list[ProjectRow]:
        raise NotImplementedError(_NI)

    async def update_project(
        self, project_id: str, fields: dict[str, Any]
    ) -> ProjectRow | None:
        raise NotImplementedError(_NI)

    async def delete_project(self, project_id: str) -> None:
        raise NotImplementedError(_NI)

    async def count_clips(self, project_id: str) -> int:
        raise NotImplementedError(_NI)

    async def insert_clips(self, clips: list[ClipRow]) -> None:
        raise NotImplementedError(_NI)

    async def get_clip(self, clip_id: str) -> ClipRow | None:
        raise NotImplementedError(_NI)

    async def list_clips(self, project_id: str) -> list[ClipRow]:
        raise NotImplementedError(_NI)

    async def update_clip(
        self, clip_id: str, fields: dict[str, Any]
    ) -> ClipRow | None:
        raise NotImplementedError(_NI)

    async def delete_clips_for_project(self, project_id: str) -> None:
        raise NotImplementedError(_NI)

    async def enqueue_job(self, job: JobRow) -> None:
        raise NotImplementedError(_NI)

    async def claim_next_pending_job(self) -> JobRow | None:
        raise NotImplementedError(_NI)

    async def mark_job_done(self, job_id: str) -> None:
        raise NotImplementedError(_NI)

    async def mark_job_failed(self, job_id: str, error: str) -> None:
        raise NotImplementedError(_NI)
