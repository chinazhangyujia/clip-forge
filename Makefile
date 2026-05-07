.PHONY: help install install-backend install-web \
        run-backend run-web \
        build build-backend build-web \
        build-desktop fetch-ffmpeg \
        lint lint-backend lint-web \
        format format-backend format-web \
        clean

# Default target — show help
help:
	@echo "ClipForge monorepo make targets:"
	@echo ""
	@echo "  install            Install backend and web dependencies"
	@echo "  install-backend    Install backend deps via uv (creates backend/.venv, uv.lock)"
	@echo "  install-web        Install web (Node) dependencies"
	@echo ""
	@echo "  run-backend        Start FastAPI dev server (http://localhost:8000)"
	@echo "  run-web            Start Next.js dev server (http://localhost:3000)"
	@echo ""
	@echo "  build              Build both backend and web"
	@echo "  build-backend      Compile-check backend Python sources"
	@echo "  build-web          Build Next.js production bundle"
	@echo "  build-desktop      Build the Tauri desktop installer (.dmg/.msi)"
	@echo "  fetch-ffmpeg       Download static ffmpeg/ffprobe for this platform"
	@echo ""
	@echo "  lint               Lint both backend and web"
	@echo "  lint-backend       Lint backend with ruff"
	@echo "  lint-web           Lint web with eslint"
	@echo ""
	@echo "  format             Auto-fix formatting in both"
	@echo "  clean              Remove build artifacts and caches"

# ---------- install ----------

install: install-backend install-web

install-backend:
	cd backend && uv sync --extra dev

install-web:
	cd web && npm install

# ---------- run ----------

run-backend:
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

run-web:
	cd web && npm run dev

# ---------- build ----------

build: build-backend build-web

build-backend:
	cd backend && uv run python -m compileall -q app

build-web:
	cd web && npm run build

# Full desktop installer build (Mac .dmg or Windows .msi). Requires:
#   - Rust toolchain (rustup default stable, with ~/.cargo/bin in PATH)
#   - Tauri CLI (`cargo install tauri-cli --version "^2.0" --locked`)
#   - CLIPFORGE_DEEPSEEK_API_KEY env var (and optionally ANTHROPIC) — these
#     are baked into the Tauri binary at compile time.
build-desktop:
	bash desktop/scripts/build.sh

fetch-ffmpeg:
	bash desktop/scripts/fetch-ffmpeg.sh

# ---------- lint ----------

lint: lint-backend lint-web

lint-backend:
	cd backend && uv run ruff check app

lint-web:
	cd web && npm run lint

# ---------- format ----------

format: format-backend format-web

format-backend:
	cd backend && uv run ruff format app && uv run ruff check --fix app

format-web:
	cd web && npx eslint --fix src

# ---------- clean ----------

clean:
	rm -rf backend/.venv backend/.ruff_cache backend/.pytest_cache backend/build backend/dist
	find backend -type d -name __pycache__ -prune -exec rm -rf {} +
	find backend -type d -name "*.egg-info" -prune -exec rm -rf {} +
	rm -rf web/node_modules web/.next web/out
	rm -rf desktop/build desktop/src-tauri/target desktop/src-tauri/binaries desktop/src-tauri/gen
