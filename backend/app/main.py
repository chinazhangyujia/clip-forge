import asyncio
import logging
import os
import platform
import sys
import tempfile
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# FastAPI's body-parse catch-all raises `starlette.exceptions.HTTPException`,
# NOT `fastapi.HTTPException` (which is a subclass). Register the handler
# against the Starlette base so the dispatcher's MRO walk finds us for
# instances of either class.
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import jobs
from .blobstore import get_blobstore
from .config import settings
from .datastore import get_datastore
from .routes import clips as clips_routes
from .routes import projects as projects_routes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    ds = get_datastore()
    bs = get_blobstore()
    await ds.init()
    await bs.init()
    stop_event = asyncio.Event()
    worker = asyncio.create_task(jobs.worker_loop(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        await worker
        await bs.close()
        await ds.close()


app = FastAPI(title="ClipForge", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    # Origins: Next dev server (web profile), and the Tauri WebView's custom
    # protocol on macOS/Windows. The backend binds to 127.0.0.1 so external
    # traffic can't reach it regardless.
    allow_origin_regex=r"^(http://localhost(:\d+)?|https?://tauri\.localhost|tauri://localhost)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_env_snapshot() -> dict[str, object]:
    """Filesystem + platform info that's typically load-bearing when a
    multipart upload fails: the temp dir Starlette spools to, the workspace
    we'd write the source file into, and basic OS identity. Each access is
    wrapped because a broken environment is exactly when this runs."""
    snap: dict[str, object] = {}
    try:
        snap["platform"] = platform.platform()
    except Exception as e:  # pragma: no cover
        snap["platform_error"] = repr(e)
    try:
        snap["python"] = sys.version.split(" ", 1)[0]
    except Exception as e:  # pragma: no cover
        snap["python_error"] = repr(e)
    try:
        td = tempfile.gettempdir()
        snap["tempdir"] = td
        snap["tempdir_writable"] = os.access(td, os.W_OK)
    except Exception as e:  # pragma: no cover
        snap["tempdir_error"] = repr(e)
    try:
        wd = settings.workspace_dir
        snap["workspace_dir"] = str(wd)
        snap["workspace_writable"] = wd.exists() and os.access(wd, os.W_OK)
    except Exception as e:  # pragma: no cover
        snap["workspace_error"] = repr(e)
    return snap


@app.exception_handler(StarletteHTTPException)
async def detailed_http_exception_handler(request: Request, exc: StarletteHTTPException):
    # FastAPI's request-body code path catches every exception from
    # `request.form()` / `request.json()` and re-raises a generic 400
    # (`There was an error parsing the body`), discarding the real cause from
    # the response. That's a debugging black hole for the desktop bundle —
    # especially on Windows, where temp-file/antivirus/codepage failures all
    # collapse into the same opaque message. Surface the chained __cause__,
    # the full traceback, and an env snapshot so a non-technical user can
    # copy-paste one block and we can diagnose without another round-trip.
    #
    # We do the same thing for any HTTPException with a chained `__cause__`
    # (i.e. `raise HTTPException(...) from e`) — the download route raises
    # `from e` when ffmpeg fails, and the user otherwise sees a bare
    # "Failed to fetch" on Windows with no way to know what went wrong.
    is_body_parse_400 = (
        exc.status_code == 400
        and exc.detail == "There was an error parsing the body"
    )
    cause = exc.__cause__
    if is_body_parse_400 or cause is not None:
        body: dict[str, object] = {
            "detail": exc.detail,
            "method": request.method,
            "path": request.url.path,
            "env": _safe_env_snapshot(),
        }
        if cause is not None:
            log.exception(
                "%s %s failed with status %d — cause: %s: %s",
                request.method, request.url.path, exc.status_code,
                type(cause).__name__, cause,
            )
            body["cause_type"] = type(cause).__name__
            body["cause"] = "".join(
                traceback.format_exception_only(type(cause), cause)
            ).strip()
            # Full chained traceback (cause + context). Includes file paths
            # and line numbers — pinpoints whether the failure was in
            # tempfile creation, multipart parsing, our route handler, etc.
            body["traceback"] = "".join(
                traceback.format_exception(type(cause), cause, cause.__traceback__)
            ).strip()
        else:
            log.error(
                "%s %s failed with status %d — no chained __cause__ attached",
                request.method, request.url.path, exc.status_code,
            )
            body["cause_type"] = None
            body["cause"] = "(no underlying exception was attached)"
        return JSONResponse(status_code=exc.status_code, content=body)
    return await http_exception_handler(request, exc)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Anything that isn't an HTTPException (e.g. a route handler raised
    # RuntimeError, KeyError, JSONDecodeError) defaults to Starlette's
    # blank "Internal Server Error" response — no body, no detail. That
    # produces the same dead-end on the desktop bundle as the upload /
    # download paths used to, since the frontend's diagnostic modal has
    # nothing to render.
    #
    # Mirror the HTTPException-with-cause path: serialize the type, the
    # one-line message, the full traceback, and an env snapshot into a
    # 500 JSON body. The frontend formatter already handles this shape.
    log.exception(
        "%s %s raised an unhandled %s",
        request.method, request.url.path, type(exc).__name__,
    )
    body: dict[str, object] = {
        "detail": f"Unhandled server error: {type(exc).__name__}",
        "method": request.method,
        "path": request.url.path,
        "env": _safe_env_snapshot(),
        "cause_type": type(exc).__name__,
        "cause": "".join(
            traceback.format_exception_only(type(exc), exc)
        ).strip(),
        "traceback": "".join(
            traceback.format_exception(type(exc), exc, exc.__traceback__)
        ).strip(),
    }
    return JSONResponse(status_code=500, content=body)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/diag")
def diag() -> dict[str, object]:
    """Environment snapshot for triage. Intentionally callable independent
    of any failure so the frontend can surface it on demand."""
    return _safe_env_snapshot()


app.include_router(projects_routes.router)
app.include_router(clips_routes.router)
