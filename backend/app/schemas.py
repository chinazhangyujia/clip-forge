"""Pydantic schemas for the public API. Field names are emitted as camelCase."""

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from .datastore import ClipRow, ProjectRow


class APIModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class PipelineState(APIModel):
    transcribe: str
    cut: str
    render: str
    package: str


class ProjectFile(APIModel):
    name: str
    size: str
    duration: str
    duration_sec: float


class Project(APIModel):
    id: str
    name: str
    status: Literal["Draft", "Processing", "Ready", "Failed"]
    clip_count: int
    updated_at: int
    created_at: int
    file: ProjectFile | None
    prompt: str
    pipeline: PipelineState
    pipeline_error: str | None = None


class ClipOriginal(APIModel):
    start_sec: float
    end_sec: float


class Clip(APIModel):
    id: str
    project_id: str
    title: str
    duration: float
    start_sec: float
    end_sec: float
    variants: list[str]
    description: str
    hashtags: list[str]
    hook_text: str
    thumb_frame: int
    original: ClipOriginal
    stale_variants: list[str]
    needs_render: bool


class ClipUpdate(APIModel):
    start_sec: float
    end_sec: float


class ProjectUpdate(APIModel):
    name: str | None = None
    prompt: str | None = None


# ---------- helpers ----------


def fmt_size(bytes_: int) -> str:
    n: float = float(bytes_)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} PB"


def fmt_duration(sec: float) -> str:
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def project_row_to_dto(row: ProjectRow, clip_count: int) -> Project:
    file: ProjectFile | None = None
    if row.source_filename:
        file = ProjectFile(
            name=row.source_filename,
            size=fmt_size(row.source_size_bytes or 0),
            duration=fmt_duration(row.source_duration_sec or 0),
            duration_sec=row.source_duration_sec or 0,
        )
    return Project(
        id=row.id,
        name=row.name,
        status=row.status,  # type: ignore[arg-type]
        clip_count=clip_count,
        updated_at=row.updated_at,
        created_at=row.created_at,
        file=file,
        prompt=row.prompt,
        pipeline=PipelineState(
            transcribe=row.pipeline_transcribe,
            cut=row.pipeline_cut,
            render=row.pipeline_render,
            package=row.pipeline_package,
        ),
        pipeline_error=row.pipeline_error,
    )


def clip_row_to_dto(row: ClipRow) -> Clip:
    return Clip(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        duration=row.end_sec - row.start_sec,
        start_sec=row.start_sec,
        end_sec=row.end_sec,
        variants=row.variants,
        description=row.description,
        hashtags=row.hashtags,
        hook_text=row.hook_text,
        thumb_frame=row.thumb_frame,
        original=ClipOriginal(
            start_sec=row.original_start_sec, end_sec=row.original_end_sec
        ),
        stale_variants=row.stale_variants,
        needs_render=row.needs_render,
    )
