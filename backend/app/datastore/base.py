"""DataStore interface + internal row models.

Row models are the canonical internal representation of persisted records,
distinct from the API DTOs in `schemas.py` (which add camelCase aliasing for
HTTP). Implementations of `DataStore` work with these rows.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from pydantic import BaseModel, Field


class ProjectRow(BaseModel):
    id: str
    name: str
    status: str
    prompt: str = ""
    source_filename: str | None = None
    source_size_bytes: int | None = None
    source_duration_sec: float | None = None
    pipeline_transcribe: str = "queued"
    pipeline_cut: str = "queued"
    pipeline_render: str = "queued"
    pipeline_package: str = "queued"
    pipeline_error: str | None = None
    # Parent directory the project's files live in (chosen at creation, locked
    # for the project's lifetime). None for legacy projects → falls back to
    # the global workspace_dir at path-resolution time.
    library: str | None = None
    created_at: int
    updated_at: int


class ClipRow(BaseModel):
    id: str
    project_id: str
    title: str
    start_sec: float
    end_sec: float
    original_start_sec: float
    original_end_sec: float
    variants: list[str] = Field(default_factory=lambda: ["original"])
    stale_variants: list[str] = Field(default_factory=list)
    needs_render: bool = True
    description: str = ""
    hashtags: list[str] = Field(default_factory=list)
    hook_text: str = ""
    thumb_frame: int = 0
    created_at: int
    updated_at: int


class JobRow(BaseModel):
    id: str
    project_id: str
    clip_id: str | None = None
    kind: str
    payload: dict[str, Any] | None = None
    status: str = "pending"
    error: str | None = None
    created_at: int
    started_at: int | None = None
    finished_at: int | None = None


class DataStore(ABC):
    """Abstract data store for ClipForge persistent state.

    Implementations are responsible for atomicity within each operation but
    callers shouldn't assume cross-operation transactions are available.
    """

    @abstractmethod
    async def init(self) -> None:
        """One-time setup (e.g. create tables / files)."""

    @abstractmethod
    async def close(self) -> None:
        """Release any resources (connections, locks)."""

    # ---------- projects ----------

    @abstractmethod
    async def insert_project(self, project: ProjectRow) -> None: ...

    @abstractmethod
    async def get_project(self, project_id: str) -> ProjectRow | None: ...

    @abstractmethod
    async def list_projects(self) -> list[ProjectRow]: ...

    @abstractmethod
    async def update_project(
        self, project_id: str, fields: dict[str, Any]
    ) -> ProjectRow | None: ...

    @abstractmethod
    async def delete_project(self, project_id: str) -> None:
        """Delete the project, all its clips, and any jobs referencing it."""

    @abstractmethod
    async def count_clips(self, project_id: str) -> int: ...

    # ---------- clips ----------

    @abstractmethod
    async def insert_clips(self, clips: list[ClipRow]) -> None: ...

    @abstractmethod
    async def get_clip(self, clip_id: str) -> ClipRow | None: ...

    @abstractmethod
    async def list_clips(self, project_id: str) -> list[ClipRow]: ...

    @abstractmethod
    async def update_clip(
        self, clip_id: str, fields: dict[str, Any]
    ) -> ClipRow | None: ...

    @abstractmethod
    async def delete_clips_for_project(self, project_id: str) -> None: ...

    # ---------- jobs ----------

    @abstractmethod
    async def enqueue_job(self, job: JobRow) -> None: ...

    @abstractmethod
    async def claim_next_pending_job(self) -> JobRow | None:
        """Atomically transition the oldest pending job to running and return it.
        Returns None if no pending jobs."""

    @abstractmethod
    async def mark_job_done(self, job_id: str) -> None: ...

    @abstractmethod
    async def mark_job_failed(self, job_id: str, error: str) -> None: ...
