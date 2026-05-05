import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import jobs
from .blobstore import get_blobstore
from .datastore import get_datastore
from .routes import clips as clips_routes
from .routes import projects as projects_routes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


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
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(projects_routes.router)
app.include_router(clips_routes.router)
