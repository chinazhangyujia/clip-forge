# PyInstaller spec for the ClipForge backend sidecar.
#
# Invoke from the backend/ directory:
#   cd backend && uv run pyinstaller ../desktop/scripts/backend.spec \
#       --workpath ../desktop/build/backend-work \
#       --distpath ../desktop/build/backend-dist \
#       --noconfirm
#
# Paths inside this spec resolve relative to the spec file itself, so the
# invocation cwd doesn't matter.
#
# Output: <distpath>/clipforge-backend/clipforge-backend  (--onedir layout).
# The bundle ships everything Python needs at runtime (interpreter, stdlib,
# fastapi/uvicorn, faster-whisper + ctranslate2 native libs, tokenizers Rust
# binaries). It does NOT bundle ffmpeg/ffprobe — those are provided by the
# Tauri shell as separate resources alongside the binary.

import os

from PyInstaller.utils.hooks import collect_all

SPEC_DIR = os.path.dirname(os.path.abspath(SPEC))  # noqa: F821 (PyInstaller-provided)
BACKEND_DIR = os.path.abspath(os.path.join(SPEC_DIR, "..", "..", "backend"))
ENTRY = os.path.join(BACKEND_DIR, "app", "desktop_entry.py")

# Pre-downloaded faster-whisper "base" model. fetch-whisper.sh populates this
# directory before PyInstaller runs. If absent, we skip — the bundled app
# falls back to downloading at first transcribe (legacy behavior).
WHISPER_DIR = os.path.abspath(os.path.join(SPEC_DIR, "..", "build", "whisper-base"))

datas = []
binaries = []
hiddenimports = []

if os.path.isdir(WHISPER_DIR) and os.path.exists(os.path.join(WHISPER_DIR, "model.bin")):
    datas.append((WHISPER_DIR, "whisper-base"))

# faster-whisper pulls in heavy native deps (ctranslate2 .dylib/.dll/.so files,
# tokenizers Rust binaries, huggingface-hub for model fetch). Use collect_all
# so PyInstaller grabs every package data file + dynamic lib.
for pkg in (
    "faster_whisper",
    "ctranslate2",
    "tokenizers",
    "huggingface_hub",
    "tqdm",
    "av",
    "onnxruntime",
    # zhconv ships its conversion table as zhcdict.json — needs collect_all
    # to bundle the data file alongside the .py code.
    "zhconv",
    # cv2 ships Haar cascade XML files under cv2/data/ that the reframe
    # pipeline loads at runtime. collect_all picks up both the native
    # binaries and the data dir.
    "cv2",
):
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(pkg)
        datas += pkg_datas
        binaries += pkg_binaries
        hiddenimports += pkg_hidden
    except Exception:
        # Package may be unavailable on this platform (e.g. onnxruntime is
        # optional). Skip silently — runtime will surface a clear error if it
        # turns out to be needed.
        pass

# uvicorn[standard] picks transports dynamically, so PyInstaller can't see
# these imports. Hardcode them.
hiddenimports += [
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.loops.uvloop",
    "uvicorn.logging",
    "h11",
    "httptools",
    "websockets",
    "wsproto",
    "watchfiles",
    "multipart",
    "python_multipart",
    "anyio._backends._asyncio",
    "asyncio",
]

# App submodules — should be picked up automatically but list explicitly so a
# rename doesn't silently drop one.
hiddenimports += [
    "app.main",
    "app.config",
    "app._resources",
    "app.jobs",
    "app.pipeline",
    "app.reframe",
    "app.schemas",
    "app.silence",
    "app.blobstore.local",
    "app.blobstore.s3",
    "app.datastore.local",
    "app.datastore.postgres",
    "app.providers.claude",
    "app.providers.deepseek",
    "app.routes.clips",
    "app.routes.projects",
]

a = Analysis(
    [ENTRY],
    pathex=[BACKEND_DIR],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[
        # PyInstaller often pulls these in unnecessarily.
        "tkinter",
        "test",
        "unittest",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="clipforge-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="clipforge-backend",
)
