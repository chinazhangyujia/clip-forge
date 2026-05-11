"""Background job queue + worker.

Jobs are persisted in the configured DataStore. A single asyncio task picks up
pending jobs and runs them sequentially. The worker is started/stopped via the
FastAPI lifespan.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from time import monotonic

from . import pipeline
from .datastore import ClipInterval, ClipRemovedCut, ClipRow, JobRow, get_datastore

log = logging.getLogger(__name__)

KIND_PIPELINE = "pipeline"
KIND_RENDER_CLIP = "render_clip"

POLL_INTERVAL_SEC = 1.0


def _now_ms() -> int:
    return int(time.time() * 1000)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(4)}"


# ---------- enqueue helpers ----------


async def enqueue_pipeline(project_id: str) -> str:
    ds = get_datastore()
    job = JobRow(
        id=_new_id("j"),
        project_id=project_id,
        kind=KIND_PIPELINE,
        status="pending",
        created_at=_now_ms(),
    )
    await ds.enqueue_job(job)
    return job.id


async def enqueue_render_clip(project_id: str, clip_id: str) -> str:
    ds = get_datastore()
    job = JobRow(
        id=_new_id("j"),
        project_id=project_id,
        clip_id=clip_id,
        kind=KIND_RENDER_CLIP,
        status="pending",
        created_at=_now_ms(),
    )
    await ds.enqueue_job(job)
    return job.id


# ---------- pipeline job ----------


async def _set_stage(project_id: str, stage: str, value: str) -> None:
    ds = get_datastore()
    await ds.update_project(
        project_id, {f"pipeline_{stage}": value, "updated_at": _now_ms()}
    )


async def _set_status(
    project_id: str, status: str, error: str | None = None
) -> None:
    ds = get_datastore()
    await ds.update_project(
        project_id,
        {"status": status, "pipeline_error": error, "updated_at": _now_ms()},
    )


async def _run_pipeline(project_id: str) -> None:
    ds = get_datastore()
    project = await ds.get_project(project_id)
    if project is None:
        raise RuntimeError(f"Project {project_id} not found")

    pipeline_t0 = monotonic()
    log.info(
        "[%s] PIPELINE START (source: %s, %.0fs)",
        project_id,
        project.source_filename,
        project.source_duration_sec or 0.0,
    )

    # Stage: transcribe
    t0 = monotonic()
    log.info("[%s] STAGE transcribe START", project_id)
    await _set_stage(project_id, "transcribe", "running")
    try:
        segments = await pipeline.transcribe(project_id)
    except Exception:
        await _set_stage(project_id, "transcribe", "failed")
        raise
    log.info(
        "[%s] STAGE transcribe DONE (%.1fs, %d segments)",
        project_id, monotonic() - t0, len(segments),
    )
    await _set_stage(project_id, "transcribe", "done")

    # Stage: cut
    t0 = monotonic()
    log.info("[%s] STAGE cut START", project_id)
    await _set_stage(project_id, "cut", "running")
    try:
        cuts = await pipeline.propose_cuts(
            project_id, project.prompt, project.source_duration_sec or 0.0
        )
    except Exception:
        await _set_stage(project_id, "cut", "failed")
        raise

    await ds.delete_clips_for_project(project_id)
    now = _now_ms()
    clip_rows: list[ClipRow] = []
    for i, c in enumerate(cuts):
        clip_id = f"{project_id}-c{i + 1}"
        clip_rows.append(
            ClipRow(
                id=clip_id,
                project_id=project_id,
                title=c.title,
                # Outer source-time bounds — used by neighbor checks and
                # legacy queries. The actual render uses `intervals`.
                start_sec=c.src_start,
                end_sec=c.src_end,
                original_start_sec=c.src_start,
                original_end_sec=c.src_end,
                intervals=[
                    ClipInterval(start_sec=s, end_sec=e) for s, e in c.intervals
                ],
                removed_cuts=[
                    ClipRemovedCut(
                        src_start=rc.src_start,
                        src_end=rc.src_end,
                        reason=rc.reason,
                    )
                    for rc in c.removed_cuts
                ],
                needs_render=True,
                description="",
                hashtags=[],
                hook_text="",
                thumb_frame=0,
                created_at=now,
                updated_at=now,
            )
        )
    await ds.insert_clips(clip_rows)
    log.info(
        "[%s] STAGE cut DONE (%.1fs, %d cuts)",
        project_id, monotonic() - t0, len(cuts),
    )
    await _set_stage(project_id, "cut", "done")

    # Mark render/package stages done in the DB so the UI's PipelineCard
    # transitions cleanly. We don't render inline here — the project page
    # is interactive once the cut stage is done and the user shouldn't
    # have to wait for ffmpeg to be able to scrub clips.
    await _set_stage(project_id, "render", "done")
    await _set_stage(project_id, "package", "done")
    await _set_status(project_id, "Ready")
    log.info(
        "[%s] PIPELINE DONE (%.1fs total) — enqueueing %d clip renders",
        project_id, monotonic() - pipeline_t0, len(clip_rows),
    )
    # Eagerly enqueue per-clip render jobs. The worker is sequential, so
    # these will run one after another, but they kick off immediately
    # after this pipeline job completes — by the time the user opens a
    # clip and hits Download, the file is very likely already on disk.
    # That matters on Windows in particular, where letting the HTTP
    # request idle for tens of seconds while ffmpeg ran was getting the
    # connection cut by the OS/WebView2. ensure_clip_rendered is
    # idempotent so even if the user mashes Download before a render
    # job runs, we don't double up.
    for clip in clip_rows:
        await enqueue_render_clip(project_id, clip.id)


# ---------- render-clip job ----------


async def _run_render_clip(project_id: str, clip_id: str) -> None:
    # Go through the shared ensure_clip_rendered helper so this job and a
    # concurrent download-endpoint call serialize through the same lock and
    # skip ffmpeg entirely if the clip is already up to date.
    await pipeline.ensure_clip_rendered(project_id, clip_id)


# ---------- worker loop ----------


async def _execute_job(job: JobRow) -> None:
    ds = get_datastore()
    try:
        if job.kind == KIND_PIPELINE:
            await _run_pipeline(job.project_id)
        elif job.kind == KIND_RENDER_CLIP:
            assert job.clip_id is not None
            await _run_render_clip(job.project_id, job.clip_id)
        else:
            raise RuntimeError(f"Unknown job kind: {job.kind}")
        await ds.mark_job_done(job.id)
    except Exception as e:
        # Print a loud, scannable error block so it's easy to spot among the
        # INFO-level pipeline progress lines.
        log.error("=" * 78)
        log.error(
            "[%s] JOB %s FAILED (%s): %s", job.project_id, job.id, job.kind, e
        )
        log.exception("[%s] Traceback:", job.project_id)
        log.error("=" * 78)
        await ds.mark_job_failed(job.id, str(e))
        if job.kind == KIND_PIPELINE:
            await _set_status(job.project_id, "Failed", str(e))


async def worker_loop(stop_event: asyncio.Event) -> None:
    log.info("Job worker started")
    ds = get_datastore()
    while not stop_event.is_set():
        job = await ds.claim_next_pending_job()
        if job is None:
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=POLL_INTERVAL_SEC)
            except TimeoutError:
                pass
            continue
        await _execute_job(job)
    log.info("Job worker stopped")
