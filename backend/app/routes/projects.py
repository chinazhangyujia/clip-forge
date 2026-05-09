import base64
import json
import logging
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse

from .. import _project_paths as pp
from .. import jobs, pipeline
from ..datastore import ProjectRow, get_datastore
from ..schemas import (
    Clip,
    Project,
    ProjectUpdate,
    clip_row_to_dto,
    project_row_to_dto,
)

log = logging.getLogger(__name__)

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


def _decode_project_metadata(header_value: str | None) -> dict[str, object]:
    if not header_value:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Missing X-Clipforge-Project-Metadata header.",
        )
    try:
        raw = base64.b64decode(header_value, validate=True)
        return json.loads(raw)
    except (ValueError, json.JSONDecodeError) as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Could not decode X-Clipforge-Project-Metadata ({type(e).__name__}): {e}",
        ) from e


@router.post("", response_model=Project, response_model_by_alias=True)
async def create_project(request: Request) -> Project:
    """Create a project by streaming the source video straight from the
    request body to the destination file.

    We deliberately avoid FastAPI's `UploadFile` / multipart form parsing here
    because Starlette's `MultiPartParser` writes the file body to a
    SpooledTemporaryFile under `%TEMP%` first, and our handler then has to
    copy that temp file to the per-project workspace path. For a multi-GB
    upload that means peak disk usage of ~2× the file size, on whichever
    drive holds %TEMP%. On Windows that drive is almost always C:, which is
    where users tend to be tight on space — see ENOSPC reports from the
    desktop bundle.

    The frontend now sends the file as the raw request body
    (`Content-Type: application/octet-stream`) and packs name/prompt/
    filename/library into a single base64-JSON header. We stream chunks from
    `request.stream()` to the destination — peak disk usage is ~1× the file
    size, on the drive the user actually picked for their workspace.
    """
    meta = _decode_project_metadata(
        request.headers.get("x-clipforge-project-metadata"),
    )
    name = (meta.get("name") if isinstance(meta.get("name"), str) else "").strip()
    prompt = (meta.get("prompt") if isinstance(meta.get("prompt"), str) else "").strip()
    filename_raw = meta.get("filename") if isinstance(meta.get("filename"), str) else None
    library_raw = meta.get("library") if isinstance(meta.get("library"), str) else None
    library_dir = (library_raw or "").strip() or None

    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "name is required")
    if not prompt:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "prompt is required")

    project_id = _new_project_id()
    src_filename = Path(filename_raw or "source.mp4").name
    ext = Path(src_filename).suffix.lower() or ".mp4"
    src_path = pp.source_path_raw(library_dir, project_id, ext)

    size_bytes = 0
    try:
        with src_path.open("wb") as out:
            async for chunk in request.stream():
                if chunk:
                    out.write(chunk)
                    size_bytes += len(chunk)
    except OSError as e:
        # Most common on Windows: ENOSPC (Errno 28). Surface a friendly
        # message and clean up the partial file before the route returns.
        pp.delete_project_dir(library_dir, project_id)
        if getattr(e, "errno", None) == 28:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                (
                    f"Not enough free disk space at {src_path.parent} to save this video. "
                    "Free up space, or click 'Change…' on the Saving to row to pick a "
                    "folder on a drive with more room."
                ),
            ) from e
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Could not write video to disk ({type(e).__name__}): {e}",
        ) from e

    if size_bytes == 0:
        pp.delete_project_dir(library_dir, project_id)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Upload body was empty — no video bytes received.",
        )

    try:
        duration_sec = await pipeline.probe_duration_sec(src_path)
    except Exception as e:
        log.exception(
            "ffprobe failed for project %s (uploaded %s bytes to %s, exists=%s)",
            project_id, size_bytes, src_path, src_path.exists(),
        )
        pp.delete_project_dir(library_dir, project_id)
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Could not read video metadata ({type(e).__name__}): {e}",
        ) from e

    ds = get_datastore()
    now = _now_ms()
    project = ProjectRow(
        id=project_id,
        name=name,
        status="Processing",
        prompt=prompt,
        source_filename=src_filename,
        source_size_bytes=size_bytes,
        source_duration_sec=duration_sec,
        library=library_dir,
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
    # Clear cached pipeline artifacts so transcribe/cut actually re-run.
    # `pipeline.transcribe()` and `propose_cuts()` short-circuit when the
    # output JSON already exists on disk — that's a useful optimization for
    # mid-pipeline retry, but defeats Re-run when the user is intentionally
    # asking for fresh output (e.g. after a backend update changed how
    # transcripts are normalized). The source video is left untouched.
    pp.transcript_path(existing).unlink(missing_ok=True)
    pp.cuts_path(existing).unlink(missing_ok=True)
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
    existing = await ds.get_project(project_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    await ds.delete_project(project_id)
    pp.delete_project_dir(existing.library, project_id)


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
    project = await ds.get_project(project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if not project.source_filename:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Source not yet uploaded"
        )
    path = pp.source_path(project)
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source file missing")
    ext = path.suffix.lower()
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
    ds = get_datastore()
    project = await ds.get_project(project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if name == "transcript.json":
        path = pp.transcript_path(project)
    elif name == "cuts.json":
        path = pp.cuts_path(project)
    else:  # unreachable — ARTIFACT_MEDIA whitelist is the source of truth
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown artifact {name!r}")
    if not path.exists():
        # Don't let the WebView cache a 404 — the file is written async by
        # the pipeline worker and a stale 404 makes the clip detail page
        # look like transcribe never finished even after it does.
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"{name} not yet generated for this project",
            headers={"Cache-Control": "no-store"},
        )
    return FileResponse(
        path,
        media_type=ARTIFACT_MEDIA[name],
        headers={"Cache-Control": "no-store"},
    )
