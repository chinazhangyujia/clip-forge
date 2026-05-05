import time

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from .. import pipeline
from ..blobstore import clip_key, get_blobstore
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

    updated = await ds.update_clip(
        clip_id,
        {
            "start_sec": body.start_sec,
            "end_sec": body.end_sec,
            "needs_render": True,
            "updated_at": _now_ms(),
        },
    )
    assert updated is not None
    # No render job enqueued here. The clip file (if it exists from a prior
    # download) is now stale; the next download will re-render with the new
    # bounds. In-browser review uses the source video + bounds directly.
    return clip_row_to_dto(updated)


@router.get("/{clip_id}/download")
async def download_clip(clip_id: str) -> FileResponse:
    ds = get_datastore()
    bs = get_blobstore()
    row = await ds.get_clip(clip_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")

    path = bs.local_path(clip_key(row.project_id, clip_id))

    if row.needs_render or not path.exists():
        try:
            await pipeline.slice_clip(row.project_id, clip_id, row.start_sec, row.end_sec)
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
