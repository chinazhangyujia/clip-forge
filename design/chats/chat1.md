# Design System Setup

_Started 2026-04-27 03:29 UTC_

---

## User



## Assistant

I'll build ClipForge as an interactive hi-fi prototype. Let me start by asking a few key questions to make sure I deliver what you need.

_[tool: questions_v2]_

## User

Questions answered:
- accent_color: Warm orange (energetic, creative)
- theme: Light mode primary
- density: Decide for me
- navigation: Decide for me
- screen_count: All equally
- interactivity_level: Medium — wizard advances, modals open, toggles work, fake progress animates
- video_playback: Static placeholder frame with play UI
- novelty: Decide for me

## Assistant

I've got what I need. Let me plan and build.

_[tool: update_todos]_

Design direction I'm committing to:

- **Aesthetic**: Light mode, warm orange accent (`oklch(0.68 0.17 47)` — a confident burnt-orange), warm-tinted neutrals (slight peach undertone in whites/grays). Linear-density (balanced).
- **Type**: Inter for UI + JetBrains Mono for technical metadata (file paths, timestamps, durations). Generous but not Notion-airy.
- **Routing**: Single SPA prototype with hash-based routing between all 4 screens.
- **Novelty**: Conventional with two delightful moments — (1) the pipeline stages render as a **horizontal flowing track** with animated progress between nodes, not just checkboxes; (2) clip cards have a subtle "scrub on hover" affordance.
- **Interactivity**: Medium — wizard advances, fake upload progresses, pipeline animates, clip variant tabs switch, transcript highlights tick.
- **Tweaks**: accent color, density, populated/empty states, pipeline state.

Let me get the starter and start building.

_[tool: copy_starter_component]_

Now let me build the app. I'll structure as: shared (state, chrome, primitives) → screens → main.

_[tool: write_file]_

Now the shared store + chrome:

_[tool: write_file]_

Now the shared chrome (top nav + jobs popover + toasts):

_[tool: write_file]_

_[tool: snip]_

Now Projects home:

_[tool: write_file]_

_[tool: snip]_

Now the wizard:

_[tool: write_file]_

_[tool: snip]_

Now Project Detail:

_[tool: write_file]_

_[tool: snip]_

Now Clip Detail:

_[tool: write_file]_

_[tool: snip]_

Now the main app file with router + tweaks:

_[tool: write_file]_

_[tool: snip]_

_[tool: read_file]_

_[tool: grep]_

_[tool: snip]_

_[tool: read_file]_

_[tool: snip]_

Now the index.html:

_[tool: write_file]_

_[tool: snip]_

_[tool: show_html]_

_[tool: snip]_

_[tool: done]_

_[tool: snip]_

_[tool: fork_verifier_agent]_

Built ClipForge as a 4-screen interactive prototype:

**Screens** (single-page app, hash-routed)
- **Projects home** — grid of cards with hover-revealed open/delete actions, status pills, gradient thumbnails, friendly empty state
- **New project wizard** — 3 steps with stepper, drag-drop upload + simulated chunked progress, preset prompt chips, summary recap
- **Project detail** — sticky sidebar with source player, editable metadata, vertical pipeline checklist (animates running stages); main area with clip grid; collapsible working-directory file browser
- **Clip detail** — variant tabs (Original / +Captions / +Reframe / Both — dimmed ones show "Generate"), simulated player with scrubbing + cold-open hook overlay + burned-in caption rendering, transcript that highlights the active line, inline-editable metadata with regenerate buttons, hashtag chip input, thumbnail with frame-rerolling, download dropdown

**System**
- Light mode, warm orange accent (`#ed7a42`), Inter + JetBrains Mono, soft shadows, `rounded-lg`
- Background job ticker advances pipeline stages and surfaces in the running-jobs popover (top nav, with pulse + counter)
- Toast notifications for create/upload/processing/errors
- Tweaks panel: accent color (with swatches), density, pipeline state override, empty-state toggle

Open in the running-jobs popover to jump into the active "Live Q&A — March Cohort" project to see the live pipeline animation.

## User

Apply comment

## Assistant

_[tool: snip]_

Good point. The user wants the data model and UX to acknowledge that a project is a *container* for source materials (currently 1 video MVP, but designed for multiple/mixed-media in the future). Let me reshape the relevant screens — make "Source materials" a concept (with the implication of "1 of 1, more coming soon" affordance), rename the relevant labels, and adjust the project-detail sidebar from "Source video" to a "Source materials" list with capacity for more types.

_[tool: read_file]_

_[tool: snip]_

I'll restructure the project-detail sidebar to use a "Source materials" model — keeping single-video MVP behavior but designing the surface to accept multiple/multi-format materials in the future.

_[tool: str_replace_edit]_

_[tool: snip]_

Now I need to add the file metadata list inside SourceMaterials and an "Add another material" affordance, plus update the wizard's Step 1 to be material-aware.

_[tool: read_file]_

_[tool: snip]_

_[tool: str_replace_edit]_

_[tool: snip]_

Now let me update Step 1 of the wizard to be material-aware (the file's MVP-only single video, but the surface should hint at multi-material), and update the new project's home card thumbnail label and the home page subtitle. Let me also update the Step 1 wizard's heading and the Project Card to read "materials" instead of implicitly "video".

_[tool: read_file]_

_[tool: snip]_

_[tool: str_replace_edit]_

_[tool: snip]_

_[tool: str_replace_edit]_

_[tool: snip]_

Now let me also update Step 3 review to reflect "material" framing, and fix the project card so the language doesn't imply a 1:1 video↔project model.

_[tool: str_replace_edit]_

_[tool: snip]_

_[tool: snip]_

_[tool: done]_

_[tool: snip]_

Reframed the project model away from 1-video-per-project:

- **Project detail sidebar**: section is now "Source materials" with a `1 / 1` counter, a `VIDEO` type badge on the player, the file row pulled out as a list item (so adding a second/third row is trivial), and a disabled "+ Add another material" footer with a `SOON` chip.
- **Wizard**: stepper says "Upload material", drop zone reads "Drop your source material here" with copy clarifying "One video file for now — audio, slides & multi-file projects coming soon".
- **Review step**: "Source material" instead of "Source video".

The data shape (`project.file` singular) is unchanged for MVP, so the model can grow into `project.materials[]` later without touching the surface vocabulary again.

## User

So in the home page why are we still showing one video in the project card? Is it by design or should we update it

## Assistant

_[tool: snip]_

Good catch — that's a leftover. Showing one video thumbnail still implies 1:1. Let me make the card material-aware: show a stack/count when there's a primary plus capacity for more, and label it generically.

_[tool: snip]_

_[tool: read_file]_

_[tool: snip]_

_[tool: str_replace_edit]_

_[tool: snip]_

_[tool: done]_

_[tool: snip]_

Updated the project card to show a generic **"1 material"** badge alongside the duration, instead of treating the thumbnail as the project's defining content. The empty state now reads "no materials yet". Now the card surface aligns with the multi-material future even though it still renders one video preview today.

