# Claude project notes — ClipForge

This is a monorepo with a Python FastAPI backend (`backend/`) and a TypeScript Next.js frontend (`web/`).

## Primary specification

See [requirements.md](./requirements.md) for the full MVP scope and architectural constraints. Read it before making non-trivial changes.

## Key constraints to keep in mind

1. **Two deployment targets: US dev and China production.** Every external service used in the US dev build must have a feasible Chinese equivalent (Alicloud / iFlytek / Qwen / etc.). All provider-specific code must sit behind a thin interface so swapping is config-only. See requirements.md for the mapping.
2. **MVP scope is fixed at three features:** core prompt-driven clip cutting, zoom-and-follow vertical reframe, and content packaging (captions / hook / description / thumbnail / cold-open). Voice isolation, filler-word removal, highlight scoring, timeline UI, and direct social posting are deferred — do not build them without confirmation.
3. **Long-running jobs run on a worker, not in the request handler.**

## Common commands

- `make install` — install backend and web dependencies
- `make run-backend` — start FastAPI dev server (http://localhost:8000)
- `make run-web` — start Next.js dev server (http://localhost:3000)
- `make lint` — lint both backend and web

See `Makefile` for the full target list.

## Tooling notes

- **Backend deps are managed with [uv](https://docs.astral.sh/uv/).** `pyproject.toml` is the source of truth; `uv.lock` is committed for reproducibility. To add a dep: edit `pyproject.toml` then `make install-backend` (or `cd backend && uv sync --extra dev`). To run any Python entrypoint inside the env: `uv run <cmd>`.
- **Frontend deps:** standard `npm` with `package-lock.json` committed.
