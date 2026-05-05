import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from .. import jobs, pipeline
from ..blobstore import get_blobstore, project_prefix, source_key
from ..datastore import ProjectRow, get_datastore
from ..schemas import (
    Clip,
    Project,
    ProjectUpdate,
    clip_row_to_dto,
    project_row_to_dto,
)

ARTIFACT_MEDIA = {
    "transcript.json": "application/json",
    "cuts.json": "application/json",
}

router = APIRouter(prefix="/projects", tags=["projects"])


def _now_ms() -> int:
    return int(time.time() * 1000)


def _new_project_id() -> str:
    import secrets

    return f"p_{secrets.token_hex(4)}"


@router.get("", response_model=list[Project], response_model_by_alias=True)
async def list_projects() -> list[Project]:
    ds = get_datastore()
    rows = await ds.list_projects()
    return [project_row_to_dto(r, await ds.count_clips(r.id)) for r in rows]


@router.get("/{project_id}", response_model=Project, response_model_by_alias=True)
async def get_project(project_id: str) -> Project:
    ds = get_datastore()
    row = await ds.get_project(project_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return project_row_to_dto(row, await ds.count_clips(project_id))


@router.post("", response_model=Project, response_model_by_alias=True)
async def create_project(
    name: Annotated[str, Form()],
    prompt: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
) -> Project:
    if not name.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "name is required")
    if not prompt.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "prompt is required")

    project_id = _new_project_id()
    src_filename = Path(file.filename or "source.mp4").name
    ext = Path(src_filename).suffix.lower() or ".mp4"

    bs = get_blobstore()
    ds = get_datastore()

    async def chunks() -> AsyncIterator[bytes]:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            yield chunk

    size_bytes = await bs.upload_stream(source_key(project_id, ext), chunks())

    src_path = bs.local_path(source_key(project_id, ext))
    try:
        duration_sec = await pipeline.probe_duration_sec(src_path)
    except Exception as e:
        await bs.delete_prefix(project_prefix(project_id))
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Could not read video metadata: {e}",
        ) from e

    now = _now_ms()
    project = ProjectRow(
        id=project_id,
        name=name.strip(),
        status="Processing",
        prompt=prompt.strip(),
        source_filename=src_filename,
        source_size_bytes=size_bytes,
        source_duration_sec=duration_sec,
        created_at=now,
        updated_at=now,
    )
    await ds.insert_project(project)
    await jobs.enqueue_pipeline(project_id)

    return project_row_to_dto(project, 0)


@router.patch("/{project_id}", response_model=Project, response_model_by_alias=True)
async def update_project(project_id: str, body: ProjectUpdate) -> Project:
    ds = get_datastore()
    existing = await ds.get_project(project_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    fields: dict[str, object] = {}
    if body.name is not None and body.name.strip():
        fields["name"] = body.name.strip()
    if body.prompt is not None:
        fields["prompt"] = body.prompt.strip()
    if fields:
        fields["updated_at"] = _now_ms()
        updated = await ds.update_project(project_id, fields)
        if updated is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
        existing = updated

    return project_row_to_dto(existing, await ds.count_clips(project_id))


@router.post("/{project_id}/rerun", response_model=Project, response_model_by_alias=True)
async def rerun_project(project_id: str) -> Project:
    ds = get_datastore()
    existing = await ds.get_project(project_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    updated = await ds.update_project(
        project_id,
        {
            "status": "Processing",
            "pipeline_transcribe": "queued",
            "pipeline_cut": "queued",
            "pipeline_render": "queued",
            "pipeline_package": "queued",
            "pipeline_error": None,
            "updated_at": _now_ms(),
        },
    )
    assert updated is not None
    await jobs.enqueue_pipeline(project_id)
    return project_row_to_dto(updated, await ds.count_clips(project_id))


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: str) -> None:
    ds = get_datastore()
    bs = get_blobstore()
    existing = await ds.get_project(project_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    await ds.delete_project(project_id)
    await bs.delete_prefix(project_prefix(project_id))


@router.get(
    "/{project_id}/clips",
    response_model=list[Clip],
    response_model_by_alias=True,
)
async def list_clips(project_id: str) -> list[Clip]:
    ds = get_datastore()
    rows = await ds.list_clips(project_id)
    return [clip_row_to_dto(r) for r in rows]


@router.get("/{project_id}/source")
async def get_source(project_id: str) -> FileResponse:
    """Stream the source video. Used by the Clip Detail player and the
    Source Materials player on Project Detail — the browser issues byte-range
    requests so we never push more than a few MB to the client at a time
    even for multi-GB sources. FastAPI's FileResponse handles range
    requests natively (Starlette ≥0.36)."""
    ds = get_datastore()
    bs = get_blobstore()
    project = await ds.get_project(project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if not project.source_filename:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Source not yet uploaded"
        )
    ext = Path(project.source_filename).suffix.lower() or ".mp4"
    path = bs.local_path(source_key(project_id, ext))
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source file missing")
    media = "video/mp4"
    if ext == ".mov":
        media = "video/quicktime"
    elif ext == ".webm":
        media = "video/webm"
    return FileResponse(path, media_type=media)


@router.get("/{project_id}/artifacts/{name}")
async def get_artifact(project_id: str, name: str) -> FileResponse:
    """Serve a debug artifact (transcript.json, cuts.json) from the project's
    workspace. Whitelisted to a small set of names — not a generic file
    server."""
    if name not in ARTIFACT_MEDIA:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown artifact {name!r}. Allowed: {sorted(ARTIFACT_MEDIA)}",
        )
    bs = get_blobstore()
    blob_key = f"{project_id}/{name}"
    if not await bs.exists(blob_key):
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"{name} not yet generated for this project",
        )
    return FileResponse(bs.local_path(blob_key), media_type=ARTIFACT_MEDIA[name])
