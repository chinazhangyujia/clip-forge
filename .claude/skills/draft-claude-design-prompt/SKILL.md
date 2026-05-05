---
name: draft-claude-design-prompt
description: Use when discussing a feature requirement (new feature or update of an existing one) that needs UI/UX design and the user asks for a prompt to paste into Claude Design (claude.ai/design). Outputs a self-contained prompt block tailored to the feature, structured for copy-paste use.
---

# Draft a Claude Design prompt

Use when the user has discussed a feature with you — either new or a change to an existing one — and asks for a prompt to paste into [Claude Design](https://claude.ai/design) to generate the UI mockup.

This is the sending half of a loop with `catch-up-design`:

```
discuss feature → draft-claude-design-prompt
   → user pastes into Claude Design → user gets export URL
      → catch-up-design → web/ implementation
```

## When to trigger

The user will say something like:
- "Give me a prompt for Claude Design."
- "What should I tell the design tool?"
- "Draft a design prompt for this."
- "Send this to design."

Do **not** auto-draft a prompt every time you discuss a feature — only when asked. Discussing requirements first lets you make better judgment calls in the prompt.

## Output format

Output the prompt **inline in the response**, delimited with horizontal rules so the user can select-and-copy easily. Use plain markdown — no surrounding code fences (Claude Design accepts markdown directly).

```
---

[Self-contained product brief.]

---
```

After the delimited prompt, add a short paragraph flagging any judgment calls or open questions the user might want to redirect on before pasting.

## Prompt structure

The receiving Claude Design instance starts cold with no conversation context. Brief it like a smart designer who walked into the room. Include:

1. **Title / one-liner.** What this is, in one sentence. ("Add manual trim controls to the Clip Detail screen.")

2. **Why.** The user-facing motivation in plain terms. Use a short scenario or example. Skip product-strategy language. ("Auto-cut won't always land where the creator wants. After a 1-hour source produces 30 clips, the user often needs to nudge a clip — start 15s earlier to include a setup line, or end 7s sooner to drop a tangent.")

3. **Where it goes.** Specific placement: screen + section, above / below an existing element, as a new screen / modal / inline panel. If extending an existing component, name it. ("In the Clip Detail view, between VariantTabs and Player.")

4. **The interaction itself.** Components, controls, behaviors. Cover:
   - Default values, ranges, formulas — concrete numbers beat vague descriptions ("symmetric margin = `max(clipDuration × 0.5, 15s)`" not "a reasonable margin").
   - Worked examples for parameterized behaviors ("60s clip → 120s window; 5min clip → 600s window").
   - Edge cases: what happens at boundaries, when fields are empty, when actions overlap.
   - State transitions: what shows when, what hides when.

5. **Visual style hints.** Reference existing tokens / utility classes when they apply: `var(--accent)`, `var(--bg-sunken)`, `.btn`, `.btn-sm`, `.card`, `.mono`. Otherwise leave the designer freedom — they own visual treatment.

6. **Out of scope.** Explicitly list what NOT to design. Prevents scope creep. ("Splitting a clip into two, merging clips, JKL keyboard scrubbing, multi-track audio editing.")

After the delimited block, in your normal response, flag:
- Judgment calls you made the user might want to redirect on.
- Open questions worth deciding before sending.

## Style rules

- **Self-contained.** Repeat any context the designer needs. Don't assume they've read requirements.md or chat history.
- **Specific.** Numbers, examples, edge cases — not adjectives.
- **Behavior, not implementation.** Describe what the user sees and does, not React components or CSS rules. Let the designer pick the materialization.
- **Concise.** A long prompt that repeats itself is worse than a short one that doesn't.
- **No emojis.**

## Don't

- Don't explain the loop ("paste this into Claude Design") *inside* the prompt. That's instruction for the user, not the designer.
- Don't dump `requirements.md` verbatim. Extract the relevant slice.
- Don't talk about the engineering side ("this'll be tricky to implement") — the designer doesn't care.
- Don't ask the designer multiple-choice questions. Make the call yourself or surface it to the user before generating the prompt.
- Don't include file paths or code snippets unless they're an essential reference for the designer (rare — usually CSS variable names like `var(--accent)` are the only useful code-level reference).
