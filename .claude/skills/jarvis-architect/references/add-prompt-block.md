# Recipe: add a system-prompt block or change model routing

The system prompt is composed, not monolithic (`src/lib/jarvis-prompts.js`). How
you add context depends on whether it's the **same every request** (goes in the
cached block) or **varies per turn** (must be a separate, uncached block).

## Add static prompt content (same every request)

1. Define a `JARVIS_*` string constant in `src/lib/jarvis-prompts.js` and push it
   inside `buildSystemPrompt(opts)` in the right spot. Order matters:
   `JARVIS_GUARDRAILS` stays **last** (last thing the model reads); tool blocks
   only when `tools.length > 0`; deep-mode block only when `deep`.
2. This content joins the single cached block that `api/chat.js` wraps with
   `cache_control: { type: 'ephemeral' }`. That's fine **because it's stable** —
   the cache key is the same every request.

## Add turn-varying context (weather-style)

3. **Do NOT put per-turn data through `buildSystemPrompt`** — it would change the
   cached block's text every request and blow the prompt cache. Instead follow
   the weather pattern in `api/chat.js`:
   - Build the text (intro constant like `JARVIS_WEATHER_INTRO` + formatted data).
   - Push it as a **second, separate `system` block with no `cache_control`**:
     `systemBlocks.push({ type: 'text', text: turnText })`. The first (cached)
     block stays byte-identical, so caching survives.
4. Add a matching `JARVIS_GUARDRAILS` line telling the model what to do when the
   block is **absent** (weather does this: "say you have no real-time access"
   rather than inventing) — the block is conditional, so the guardrail is too.

## Change model routing / command config

5. Model selection lives in `resolveCommandConfig(command)` and command parsing
   in `detectCommand(message)` (both in `jarvis-prompts.js`). `/profundo` →
   `{ model, deep: true, badge }`; default → the `DEFAULT` config. UI-only
   commands return `{ ...DEFAULT, uiCommand }`.
   - **Confirm model IDs with the `claude-api` skill before editing** — the code
     currently ships `claude-opus-4-7` / `claude-sonnet-4-5` here, while CLAUDE.md
     says `4-8` / `4-6`. Don't propagate a guess; fetch the live ID.
   - A model change that also touches the `web_search` tool version has a
     coupling — see `add-a-tool.md` step 6.

## Verify

- Static block: `npm run dev`, confirm the new guidance shows up in behavior and
  that a normal follow-up turn still benefits from the cache (token accounting via
  the `jarvis_tokens` event shows cached-read input on turn 2).
- Turn-varying block: confirm it appears only on the triggering turns and that
  non-triggering turns keep the cache warm.
- Routing: send the command, check the `X-Jarvis-Meta` header / `badge` reflects
  the intended model.
