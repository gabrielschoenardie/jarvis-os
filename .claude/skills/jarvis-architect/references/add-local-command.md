# Recipe: add a /local command (client-side, no API call)

A `/command` intercepted in the browser before any Anthropic round-trip — for
UI-only effects (mode switches, diagnostics, canned text). Contrast with the
special commands that *do* hit the API and only route the model (`/profundo`) —
those live in `detectCommand`/`resolveCommandConfig`; see `add-prompt-block.md`.

## Steps

1. **Handler → `handleLocalCommand(cmd, currentApiHistory)` in
   `src/hooks/useChat.js`.** Add a branch matching your command (lowercased,
   trimmed) and `return` a result object; returning `null` falls through to the
   normal API path. Existing branches show the shape:
   - `{ type: 'text', lines: [...] }` — prints canned lines (`/status`, `/briefing`, `/ajuda`).
   - `{ ..., switchMode: 'holographic' | 'terminal' }` — triggers `onModeChange`
     (`/vault`, `/holo`, `/armor`, `/terminal`).
   - `{ type: 'focus', topic }` / `{ clearFocus: true }` — drive `onFocusChange`
     (`/foco`, `/sair`).
   `submitCommand` applies these side effects for you (see lines ~128–135) — you
   only return the descriptor; don't call setters directly.

2. **Register it in the help list.** Add a line to the `/ajuda` branch so the
   command is discoverable (that branch is the single source users see).

3. **Keep it truly local.** No `fetch`, no `callClaude`. The whole point is zero
   API cost and instant response. If it needs the model, it's not a local
   command — it's a prompt/routing change (`add-prompt-block.md`).

4. **(Optional) Document it in the model's world.** If the model should *mention*
   the command to the user, add a line to `JARVIS_COMMANDS` in
   `src/lib/jarvis-prompts.js`. Purely cosmetic client commands don't need this.

## Verify

- `npm run dev`, type the command, confirm the effect fires and **no** network
  request to `/api/chat` is made (Network tab stays quiet).
- Confirm it appears in `/ajuda` output.
- Reload: local commands don't persist state beyond what `history`/`localStorage`
  already store — check the mode/focus side effect behaves on a fresh load.
