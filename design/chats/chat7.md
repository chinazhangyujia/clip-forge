# Context Menu Simplification

_Started 2026-05-12 03:16 UTC_

---

## User



## Assistant

_[tool: list_files]_

_[tool: read_file]_

_[tool: list_files]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: read_file]_

_[tool: read_file]_

_[tool: grep]_

_[tool: snip]_

_[tool: grep]_

_[tool: grep]_

_[tool: read_file]_

_[tool: snip]_

_[tool: grep]_

_[tool: snip]_

_[tool: read_file]_

_[tool: write_file]_

_[tool: snip]_

Now wire the new component into clip.jsx and the HTML file:

_[tool: str_replace_edit]_

_[tool: str_replace_edit]_

_[tool: snip]_

_[tool: str_replace_edit]_

_[tool: snip]_

_[tool: str_replace_edit]_

_[tool: snip]_

_[tool: copy_files]_

_[tool: snip]_

_[tool: write_file]_

_[tool: snip]_

_[tool: copy_files]_

_[tool: snip]_

_[tool: str_replace_edit]_

_[tool: snip]_

_[tool: show_html]_

_[tool: done]_

_[tool: snip]_

_[tool: fork_verifier_agent]_

Replaced the "Download" affordance on Clip Detail with a four-state file-on-disk control:

- **Unrendered** — "Prepare clip" CTA with a one-line explanation
- **Rendering** — shimmer progress in the same slot, no percentage
- **Ready** — green confirmation + truncated mono path + Show in Finder / Save a copy… / copy-path icon
- **Stale** — amber warning + struck-through stale path + Re-prepare

Platform-aware label flip ("Show in Finder" vs "File Explorer"), filename derived from the clip title (CJK-safe), full path on hover. Wired into `screens/clip.jsx`; design canvas redone at `Clip File Actions.html` (old chip exploration preserved as v1).

## User

remove the save a copy and copy path, only show in finder is enough

## Assistant

_[tool: snip]_

_[tool: str_replace_edit]_

_[tool: snip]_

_[tool: grep]_

_[tool: str_replace_edit]_

_[tool: snip]_

_[tool: done]_

_[tool: snip]_

Done. Ready state now shows just the confirmation, path, and a single "Show in Finder" / "Show in File Explorer" primary button.

