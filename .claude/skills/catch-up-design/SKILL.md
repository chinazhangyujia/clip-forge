---
name: catch-up-design
description: Use when the user shares a Claude Design export URL (https://api.anthropic.com/v1/design/h/...) or asks to sync the design system. Fetches the gzipped tar bundle, mirrors it into design/, classifies changes (global tokens / local UI / new features), and plans the web/ port. Small style updates auto-apply; new features require user confirmation before implementation.
---

# Catch up the design system

Run when the user pastes a Claude Design export URL (`https://api.anthropic.com/v1/design/h/<hash>`) or says "sync the design", "the design just updated", "catch up the design system".

This is the receiving half of a loop with `draft-claude-design-prompt`:

```
discuss feature → draft-claude-design-prompt
   → user pastes into Claude Design → user gets export URL
      → catch-up-design → web/ implementation
```

## Foundational principle: design/ is UI/UX only

`design/` is a byte-identical mirror of the Claude Design export. It is the **source of truth for visual intent, interaction patterns, layout, and copy** — and only those. It is **not** the source of truth for code architecture, types, file structure, state management, or any engineering choice. When porting to `web/`, match visual / interaction intent and pick whatever code structure fits the production Next.js + TypeScript stack. Do **not** copy the prototype's single-file structure, in-browser Babel, hash routing, in-memory store, prop-drilling shape, or `useEffect(() => setX(prop), [prop])` anti-patterns.

Never hand-edit files inside `design/` — edits there get overwritten on the next export.

## Workflow

### 1. Fetch and stage the bundle

The URL returns a gzipped tar. WebFetch can't render binary, but it saves the bytes to a temp `.bin` file and reports the path. Pull that path from the WebFetch response, then:

```bash
BUNDLE=<path-from-webfetch>
STAGE=/tmp/clipforge-design-new
rm -rf "$STAGE" && mkdir -p "$STAGE"
gzip -dc "$BUNDLE" | tar -xf - -C "$STAGE"
find "$STAGE" -type f
```

The bundle root is `clip-forge/`.

### 2. Diff against current design/

```bash
diff -rq design "$STAGE/clip-forge"
```

Sort differences into added / removed / modified.

### 3. Read the new chat transcript

Always read any new file under `chats/` (and any modified existing chat) before classifying changes. The chat carries the *why* the diff alone can't show. If a feature appears in the diff but isn't motivated in any chat, flag it to the user — that's usually a sign of an unintended export.

### 4. Classify each change

| Bucket | What it is | What to do |
|---|---|---|
| **Global tokens** | `design/project/styles.css` `:root` variables, shared utility classes (`.btn`, `.card`, etc.) | Port to `web/src/app/globals.css`. **Auto-apply.** |
| **Local UI / visual / copy on existing components** | Visual tweaks, color/spacing adjustments, text rewording, layout refinements within an existing screen — no new data fields, no new behaviors | Update the matching `web/src/components/...` file. **Auto-apply.** |
| **New features** | New screens, new interactions, new data fields on existing types, new components | **List scope and confirm with user before porting.** |

### 5. Sync design/ to match the export

```bash
cp -R "$STAGE/clip-forge/." design/
diff -rq design "$STAGE/clip-forge"   # should be empty
```

If files were removed in the new export, remove them from `design/` too — the goal is a byte-identical mirror.

### 6. Implement web/ changes

For auto-apply buckets: just do it. For new-feature bucket: only after the user green-lights the listed scope.

When porting, follow these rules:
- Match visual / interaction intent, not internal structure.
- Reuse utility classes from `globals.css` (`.card`, `.btn`, `.btn-sm`, `.btn-primary`, `.mono`, `.input`, `.textarea`, `.popover`, `.toast`, `.pill`, `.chip`, `.placeholder-img`).
- Use the `Icon` component from `web/src/lib/icons.tsx`. If the design references an icon name not present, add the SVG path to `icons.tsx` rather than inlining SVG.
- Extend the types in `web/src/lib/types.ts` rather than introducing untyped props.
- Update mock data in `web/src/lib/utils.ts` if new data fields land.
- Use Next.js App Router idioms (read `web/AGENTS.md` and `web/CLAUDE.md`). Dynamic-route `params` are async. The `react-hooks/set-state-in-effect` lint rule is strict — for "reset state when prop changes" cases, prefer parent-side `key={...}` re-keying over an internal `useEffect(() => setX(prop), [prop])`.

### 7. Things to NEVER ship

- The tweaks panel (`tweaks-panel.jsx`, `TweaksApp` in `app.jsx`).
- The Babel-in-browser `<script type="text/babel">` tags in `ClipForge.html`.
- Hash-based routing in `app.jsx` — production uses Next.js App Router.
- Sample data baked into `core.jsx` (`initialProjects`, `generateClips`, `SAMPLE_TRANSCRIPT`) — production wiring eventually goes to FastAPI; mocks live in `web/src/lib/utils.ts`.

### 8. Verify

```bash
make lint-web
make build-web
```

If a screen visibly changed, suggest `make run-web` and exercise the affected flow.

### 9. Report

Summarize what landed in `web/` and what was skipped (prototype-only). If anything was deferred (new features pending confirmation), call that out so the user knows the next step.
