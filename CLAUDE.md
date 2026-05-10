# Claude project notes — ClipForge

This is a monorepo with a Python FastAPI backend (`backend/`), a TypeScript Next.js frontend (`web/`), and a Tauri desktop shell (`desktop/`) that bundles them into a single `.dmg` / `.msi` installer.

## Primary specification

See [requirements.md](./requirements.md) for the full MVP scope and architectural constraints. Read it before making non-trivial changes.

## Key constraints to keep in mind

1. **Two deployment targets: US dev and China production.** Every external service used in the US dev build must have a feasible Chinese equivalent (Alicloud / iFlytek / Qwen / etc.). All provider-specific code must sit behind a thin interface so swapping is config-only. See requirements.md for the mapping.
2. **MVP scope is fixed at three features:** core prompt-driven clip cutting, manual per-clip boundary tuning, and content packaging (hook / description / thumbnail / cold-open). Vertical reframe, voice isolation, filler-word removal, highlight scoring, multi-clip timeline editing, burned-in captions, and direct social posting are deferred — do not build them without confirmation.
3. **Long-running jobs run on a worker, not in the request handler.**

## Common commands

- `make install` — install backend and web dependencies
- `make run-backend` — start FastAPI dev server (http://localhost:8000)
- `make run-web` — start Next.js dev server (http://localhost:3000)
- `make lint` — lint both backend and web

See `Makefile` for the full target list.

## Desktop bundle

For the dogfood-on-Windows-and-Mac flow, the `desktop/` folder packages a
Tauri 2 shell + PyInstaller-bundled FastAPI + static ffmpeg into one
double-clickable installer. See [`desktop/README.md`](./desktop/README.md)
for full details.

Quick paths:
- **Local Mac build:** `bash desktop/scripts/build.sh` — produces a `.dmg`
- **CI both-platforms build:** push to `main`, Actions runs `.github/workflows/build-desktop.yml`
- **Frontend changes for static export:** the `web/` build uses `output: "export"` and ships as static HTML/JS inside the Tauri WebView. Routes must be either fully static (`/projects/new`) or read runtime IDs from query params (`/project?id=X`, `/clip?project=X&clip=Y`) — Next App Router static export does not support runtime-known dynamic segments.
- **Backend desktop entry:** `backend/app/desktop_entry.py` is the PyInstaller script entry. It accepts `--data-dir`, `--port`, `--ffmpeg-dir`. Tauri spawns it and reads `CLIPFORGE_PORT=<n>` from stdout.

## Tooling notes

- **Backend deps are managed with [uv](https://docs.astral.sh/uv/).** `pyproject.toml` is the source of truth; `uv.lock` is committed for reproducibility. To add a dep: edit `pyproject.toml` then `make install-backend` (or `cd backend && uv sync --extra dev`). To run any Python entrypoint inside the env: `uv run <cmd>`.
- **Frontend deps:** standard `npm` with `package-lock.json` committed.
- **Next.js version is 16.x with React 19.** It has breaking changes vs. older Next.js. See `web/AGENTS.md` and `web/node_modules/next/dist/docs/` before writing non-trivial frontend code. Specifically: dynamic-route `params` are async (must `await`), the `react-hooks/set-state-in-effect` lint rule is strict (use the React 19 tracker pattern instead of `useEffect(() => setX(prop), [prop])`), and the `react-hooks/purity` rule disallows `Math.random()` / `Date.now()` during render.

## Design system workflow

`design/` is a mirror of the design source exported from [Claude Design](https://claude.ai/design). It contains React+CSS prototypes — **the source of truth for visual intent, not shippable code**. We translate it into production Next.js components under `web/src/`.

**Scope of authority.** The design defines visual treatment, layout, interaction patterns, copy, and component composition — and only those. It does **not** define code architecture: do not copy its single-file structure, in-browser Babel, hash routing, in-memory store, or prop-drilling patterns. When porting, match the visual / interaction intent; pick whatever code structure is right for the production Next.js + TypeScript codebase.

**The export bundle is canonical.** When the user re-exports from Claude Design, replace `design/` so it stays byte-identical to the export. Don't hand-edit files in `design/` — edits there will be overwritten on the next export and will diverge from the source of truth.

Layout:

```
design/
├── README.md                     handoff notes from Claude Design (read first)
├── chats/                        the design conversation transcripts (intent lives here)
└── project/
    ├── ClipForge.html            entry HTML
    ├── styles.css                design tokens + utility classes
    ├── core.jsx                  store, router, icons, sample data
    ├── chrome.jsx                top nav, jobs popover, toasts
    ├── app.jsx                   routes + tweaks panel (prototype-only)
    ├── tweaks-panel.jsx          tweaks UI (prototype-only — do not ship)
    └── screens/{home,new,detail,clip,trim}.jsx
```

How the design lands in `web/`:

- **Tokens** (`design/project/styles.css` `:root`) → ported into `web/src/app/globals.css` as CSS custom properties + utility classes (`.btn`, `.card`, `.pill`, `.chip`, `.input`, `.textarea`, `.topnav`, `.popover`, `.toast`, `.placeholder-img`, etc.). Don't reinvent these as Tailwind utilities — they encode the design language and stay aligned with future design updates.
- **Fonts**: Inter + JetBrains Mono via `next/font/google` in `web/src/app/layout.tsx`.
- **Primitives** (Icon, Spinner, StatusPill) → `web/src/lib/icons.tsx`, `web/src/components/StatusPill.tsx`.
- **Chrome** (TopNav, ToastHost, JobsPopover) → `web/src/components/`.
- **Screens** → one `web/src/components/screens/<Screen>.tsx` per design screen, paired with a thin Next.js route under `web/src/app/`.
- **State** → `web/src/lib/store.tsx` (mock store for now; mirrors the prototype's `core.jsx` shapes).

### When the design folder is updated

The user will re-export from Claude Design and replace `design/`. After they do that, your job is to:

1. **Diff** `design/` against the previous version (`git diff HEAD -- design/`) — figure out what changed.
2. **Read the latest chat transcript** in `design/chats/` to understand the user's intent behind the change. Don't only read the diff.
3. **Determine the production translation**:
   - Token changes (`design/project/styles.css` `:root`) → update `web/src/app/globals.css`.
   - Component / screen changes → update the matching files under `web/src/components/`.
   - Prototype-only changes (the tweaks panel, the in-browser Babel setup, sample data tweaks) → **do not propagate**.
4. **List what's changing in `web/`** before editing, and confirm with the user if scope is non-trivial.
5. **Verify after**: `make lint-web && make build-web`, then start `make run-web` and visually check the affected screens.

### Things in `design/` you should not ship

- The tweaks panel (`tweaks-panel.jsx`, `TweaksApp` in `app.jsx`) — prototype-only knobs.
- The Babel-in-browser script tags in `ClipForge.html`.
- Hash-based routing in `app.jsx` — we use Next.js App Router instead.
- Sample data baked into `core.jsx` (`initialProjects`, `generateClips`, `SAMPLE_TRANSCRIPT`) — the production store will eventually wire to the FastAPI backend; for now we mirror these shapes in `web/src/lib/utils.ts` as mocks, clearly labeled.
