import asyncio
import logging
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


@app.exception_handler(StarletteHTTPException)
async def detailed_http_exception_handler(request: Request, exc: StarletteHTTPException):
    # FastAPI's request-body code path catches every exception from
    # `request.form()` / `request.json()` and re-raises a generic 400
    # (`There was an error parsing the body`), discarding the real cause from
    # the response. That's a debugging black hole for the desktop bundle —
    # especially on Windows, where temp-file/antivirus/codepage failures all
    # collapse into the same opaque message. Surface the chained __cause__ so
    # the user can copy-paste it back to us.
    if (
        exc.status_code == 400
        and exc.detail == "There was an error parsing the body"
        and exc.__cause__ is not None
    ):
        cause = exc.__cause__
        log.exception(
            "Body parse failed for %s %s — cause: %s: %s",
            request.method, request.url.path, type(cause).__name__, cause,
        )
        cause_summary = "".join(
            traceback.format_exception_only(type(cause), cause)
        ).strip()
        return JSONResponse(
            status_code=400,
            content={
                "detail": "There was an error parsing the body",
                "cause_type": type(cause).__name__,
                "cause": cause_summary,
                "method": request.method,
                "path": request.url.path,
            },
        )
    return await http_exception_handler(request, exc)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(projects_routes.router)
app.include_router(clips_routes.router)
