import json
import time

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from .. import _project_paths as pp
from .. import jobs, pipeline, silence
from ..datastore import get_datastore
from ..schemas import Clip, ClipUpdate, clip_row_to_dto

router = APIRouter(prefix="/clips", tags=["clips"])


def _now_ms() -> int:
    return int(time.time() * 1000)


@router.get("/{clip_id}", response_model=Clip, response_model_by_alias=True)
async def get_clip(clip_id: str) -> Clip:
    ds = get_datastore()
    row = await ds.get_clip(clip_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
    return clip_row_to_dto(row)


@router.patch("/{clip_id}", response_model=Clip, response_model_by_alias=True)
async def update_clip_bounds(clip_id: str, body: ClipUpdate) -> Clip:
    if body.end_sec - body.start_sec < 0.5:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Clip must be at least 0.5 seconds long",
        )
    if body.start_sec < 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "startSec must be >= 0")

    ds = get_datastore()
    existing = await ds.get_clip(clip_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
    project = await ds.get_project(existing.project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    # Recompute the source-time intervals by intersecting the user's new
    # outer bounds with the project's speech mask. The mask is the
    # source-of-truth: if the user grew the clip into a region containing
    # silence, the silence stays removed; if they shrunk past one of the
    # clip's interior intervals, that interval drops out.
    intervals: list[dict] = []
    removed_cuts: list[dict] = []
    speech_p = pp.speech_intervals_path(project)
    if speech_p.exists():
        speech_data = json.loads(speech_p.read_text())
        mask = silence.deserialize_intervals(speech_data)
        sliced = silence.source_range_to_source_intervals(
            body.start_sec, body.end_sec, mask
        )
        if not sliced:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Selected range contains no speech — pick a wider window.",
            )
        intervals = [{"start_sec": s, "end_sec": e} for s, e in sliced]
        # Slice the project-level cut list (with reasons) to the new
        # outer bounds so the clip-detail UI keeps showing the right
        # set of pause/filler markers.
        all_cuts = silence.deserialize_cuts(speech_data)
        outer_start = sliced[0][0]
        outer_end = sliced[-1][1]
        removed_cuts = [
            {"src_start": c.src_start, "src_end": c.src_end, "reason": c.reason}
            for c in silence.cuts_in_source_range(all_cuts, outer_start, outer_end)
        ]
    else:
        # Pre-feature project: no mask available, fall back to a single
        # interval covering the user's range. The clip will play with any
        # silence that's within the bounds — same behavior as before this
        # feature shipped.
        intervals = [{"start_sec": body.start_sec, "end_sec": body.end_sec}]

    # If a reframe variant already existed it's now invalidated — the
    # face trajectory was computed against the old interval set. Mark
    # stale so the UI shows it greyed out and the user can regenerate.
    stale = list(existing.stale_variants)
    if "reframe" in existing.variants and "reframe" not in stale:
        stale.append("reframe")

    updated = await ds.update_clip(
        clip_id,
        {
            "start_sec": body.start_sec,
            "end_sec": body.end_sec,
            "intervals": intervals,
            "removed_cuts": removed_cuts,
            "needs_render": True,
            "stale_variants": stale,
            "updated_at": _now_ms(),
        },
    )
    assert updated is not None
    # No render job enqueued here. The clip file (if it exists from a prior
    # download) is now stale; the next download will re-render with the new
    # bounds. In-browser review uses the source video + bounds directly.
    return clip_row_to_dto(updated)


@router.post("/{clip_id}/reframe", response_model=Clip, response_model_by_alias=True)
async def render_reframe(clip_id: str) -> Clip:
    """Kick off a 9:16 vertical-reframe render in the background. Returns
    the current clip row immediately; the frontend polls (via the regular
    list-clips endpoint) until `variants` includes 'reframe' and
    `staleVariants` does not."""
    ds = get_datastore()
    existing = await ds.get_clip(clip_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
    await jobs.enqueue_render_reframe(existing.project_id, clip_id)
    return clip_row_to_dto(existing)


@router.get("/{clip_id}/variants/{variant}")
async def get_variant(clip_id: str, variant: str) -> FileResponse:
    """Serve a non-original clip variant — currently just 'reframe'.
    The variant must already be rendered; we don't lazily render here
    (unlike /download for the original) because reframe rendering is
    user-triggered and tracked through the job queue."""
    if variant not in {"reframe"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown variant {variant!r}")
    ds = get_datastore()
    row = await ds.get_clip(clip_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
    project = await ds.get_project(row.project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if variant not in row.variants or variant in row.stale_variants:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Variant {variant!r} not yet rendered for this clip",
        )
    path = pp.clip_variant_path(project, clip_id, variant)
    if not path.exists():
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Variant file missing on disk: {path.name}",
        )
    # No-store so a regenerated variant (after a trim) isn't served from
    # the WebView's HTTP cache.
    return FileResponse(
        path,
        media_type="video/mp4",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{clip_id}/download")
async def download_clip(clip_id: str) -> FileResponse:
    ds = get_datastore()
    row = await ds.get_clip(clip_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
    project = await ds.get_project(row.project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    path = pp.clip_path(project, clip_id)

    if row.needs_render or not path.exists():
        intervals = [(iv.start_sec, iv.end_sec) for iv in row.intervals] or [
            (row.start_sec, row.end_sec)
        ]
        try:
            await pipeline.slice_clip(row.project_id, clip_id, intervals)
        except Exception as e:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                f"Failed to render clip: {e}",
            ) from e
        await ds.update_clip(
            clip_id, {"needs_render": False, "updated_at": _now_ms()}
        )

    safe_title = (row.title or clip_id).replace("/", "-").replace("\\", "-")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=f"{safe_title}.mp4",
    )
