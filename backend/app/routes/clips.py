import asyncio
import contextlib
import json
import time

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse

from .. import _project_paths as pp
from .. import jobs, pipeline, silence
from ..datastore import get_datastore
from ..schemas import Clip, ClipUpdate, clip_row_to_dto

router = APIRouter(prefix="/clips", tags=["clips"])


def _now_ms() -> int:
    return int(time.time() * 1000)


async def _watch_disconnect(request: Request) -> None:
    while True:
        if await request.is_disconnected():
            return
        await asyncio.sleep(1.0)


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
        speech_data = json.loads(speech_p.read_text(encoding="utf-8"))
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

    updated = await ds.update_clip(
        clip_id,
        {
            "start_sec": body.start_sec,
            "end_sec": body.end_sec,
            "intervals": intervals,
            "removed_cuts": removed_cuts,
            "needs_render": True,
            "updated_at": _now_ms(),
        },
    )
    assert updated is not None
    # Kick off a background render with the new bounds so the user's
    # next Download click is fast. In-browser review still uses the
    # source + bounds directly and doesn't wait on this. Idempotent
    # via ensure_clip_rendered's lock so concurrent edits don't race.
    await jobs.enqueue_render_clip(updated.project_id, clip_id)
    return clip_row_to_dto(updated)


@router.get("/{clip_id}/download")
async def download_clip(clip_id: str, request: Request) -> FileResponse:
    ds = get_datastore()
    row = await ds.get_clip(clip_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")

    # Race ensure_clip_rendered against a disconnect watcher so a closed
    # tab cancels ffmpeg instead of leaving it pinned to the CPU producing
    # output nobody is waiting for. The render is idempotent and shares
    # its lock with the worker — so even if the user already pre-rendered
    # via _run_pipeline / update_clip_bounds, this just no-ops.
    render_task = asyncio.create_task(
        pipeline.ensure_clip_rendered(row.project_id, clip_id)
    )
    disconnect_task = asyncio.create_task(_watch_disconnect(request))
    done, pending = await asyncio.wait(
        {render_task, disconnect_task},
        return_when=asyncio.FIRST_COMPLETED,
    )
    for t in pending:
        t.cancel()
        with contextlib.suppress(BaseException):
            await t
    if render_task not in done:
        # Client disconnected; render was cancelled. The response will
        # never reach the client but we still need a status to terminate
        # the route cleanly.
        raise HTTPException(499, "Client disconnected")
    try:
        path = render_task.result()
    except Exception as e:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"Failed to render clip: {e}",
        ) from e

    safe_title = (row.title or clip_id).replace("/", "-").replace("\\", "-")
    return FileResponse(
        path,
        media_type="video/mp4",
        filename=f"{safe_title}.mp4",
    )
