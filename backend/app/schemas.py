"""Pydantic schemas for the public API. Field names are emitted as camelCase."""

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from .datastore import ClipInterval as ClipIntervalRow
from .datastore import ClipRemovedCut as ClipRemovedCutRow
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
    # Parent directory of this project's files (chosen at creation). The
    # frontend pairs it with `id` to form the full project folder path.
    library: str | None = None


class ClipOriginal(APIModel):
    start_sec: float
    end_sec: float


class ClipInterval(APIModel):
    start_sec: float
    end_sec: float


class ClipRemovedCut(APIModel):
    """One automatic removal inside a clip, with the reason. Reasons are
    open-ended strings — currently 'pause' and 'filler', more to come."""

    src_start: float
    src_end: float
    reason: str


class Clip(APIModel):
    id: str
    project_id: str
    title: str
    # Compact duration — sum of interval lengths, i.e. what the player and
    # the trim header actually represent. Distinct from `end_sec - start_sec`
    # (the source-time span) because removed silences shrink the clip.
    duration: float
    start_sec: float
    end_sec: float
    # Source-time speech intervals after silence removal. Always >= 1
    # element. The player concats these for playback; the renderer concats
    # them for the downloaded MP4.
    intervals: list[ClipInterval]
    # Source-time ranges removed inside the clip, tagged with the reason
    # (long pause / filler word / …). Empty list for legacy clips
    # produced before reason-tagging shipped — frontend falls back to
    # deriving pause cuts from interval gaps in that case.
    removed_cuts: list[ClipRemovedCut]
    variants: list[str]
    description: str
    hashtags: list[str]
    hook_text: str
    thumb_frame: int
    original: ClipOriginal
    stale_variants: list[str]
    needs_render: bool


class ProjectCut(APIModel):
    """One row in the project-level Auto-cuts report. Carries enough
    context (excerpts / token) to render the row without a follow-up
    request, plus the clip id (if any) so the row can deep-link to the
    cut moment in Clip Detail."""

    id: str
    source_sec: float
    source_end_sec: float
    removed_sec: float
    reason: str
    clip_id: str | None = None
    pre: str = ""
    post: str = ""
    word: str | None = None


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
        library=row.library,
    )


def _row_intervals(row: ClipRow) -> list[ClipIntervalRow]:
    """Backfill: a clip row written before the silence-removal feature lands
    has no intervals — treat it as a single interval covering the full
    [start_sec, end_sec] source-time range."""
    if row.intervals:
        return row.intervals
    return [ClipIntervalRow(start_sec=row.start_sec, end_sec=row.end_sec)]


def _row_removed_cuts(
    row: ClipRow, intervals: list[ClipIntervalRow]
) -> list[ClipRemovedCutRow]:
    """Backfill for clips written before reason-tagging: every gap
    between consecutive intervals is a long pause. Filler cuts didn't
    exist for those clips, so this is exact for legacy data."""
    if row.removed_cuts:
        return row.removed_cuts
    out: list[ClipRemovedCutRow] = []
    for prev, nxt in zip(intervals, intervals[1:], strict=False):
        if nxt.start_sec - prev.end_sec > 0.05:
            out.append(
                ClipRemovedCutRow(
                    src_start=prev.end_sec,
                    src_end=nxt.start_sec,
                    reason="pause",
                )
            )
    return out


def clip_row_to_dto(row: ClipRow) -> Clip:
    intervals = _row_intervals(row)
    compact_duration = sum(i.end_sec - i.start_sec for i in intervals)
    removed_cuts = _row_removed_cuts(row, intervals)
    return Clip(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        duration=compact_duration,
        start_sec=row.start_sec,
        end_sec=row.end_sec,
        intervals=[ClipInterval(start_sec=i.start_sec, end_sec=i.end_sec) for i in intervals],
        removed_cuts=[
            ClipRemovedCut(src_start=c.src_start, src_end=c.src_end, reason=c.reason)
            for c in removed_cuts
        ],
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
