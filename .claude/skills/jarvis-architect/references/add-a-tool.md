# Recipe: add a custom tool to the agentic loop

Adds a new tool the model can call inside `api/chat.js`'s server-side loop. Two
kinds of tools exist — pick the pattern in step 5 that matches your effect.

## Steps

1. **JSON schema → `src/lib/jarvis-tools.js`, `JARVIS_TOOLS` only.**
   Append an entry `{ name, description, input_schema }` to the `JARVIS_TOOLS`
   array. Also add the name to the `TOOL_NAMES` array in the same file.
   - `JARVIS_TOOLS` must stay a **stable module-level constant** — never build it
     per-request. `api/chat.js` sends `tools: JARVIS_TOOLS` on every call, and in
     Anthropic's prompt-cache hierarchy `tools` precede `system`; a varying array
     invalidates the cached identity block every request (per CLAUDE.md).
   - Schema lives here and **nowhere else** — never in the prompt file.

2. **Executor → `executeTool(name, input)` in the same file.**
   Add an `if (name === 'sua_tool') { … }` branch returning
   `{ resultText, isError, action }` (`action: null` unless it's a browser
   effect — see step 5). `executeTool` is `async` and **must stay async** (tools
   may do network I/O, e.g. `hud_display`'s oEmbed check). Both call sites in
   `api/chat.js` already `await` it — don't break that.

3. **Prose/guidance → `src/lib/jarvis-prompts.js` only.**
   Add a "when to use" paragraph to `JARVIS_TOOLS_CATALOG` (and adjust
   `JARVIS_TOOLS_INTRO` if the principle is new). **No schema fields here** — the
   split (schema in tools file, prose in prompt file) is a guarded invariant.

4. **Respect the loop mechanics in `api/chat.js`** (both the streaming and
   non-streaming branches — keep them in sync):
   - `MAX_ITERATIONS = 5` guards against infinite tool loops — don't remove it.
   - On `stop_reason: 'tool_use'`: the assistant turn is appended, then **one**
     `user` message carries **all** `tool_result`s (API requirement for parallel
     tool_use). Your branch just needs to return a well-formed result string.
   - `pause_turn` re-calls with the assistant blocks echoed back verbatim (web
     search) — don't touch unless you understand it.
   - The synthetic `"\n\n"` text delta between loop phases (streaming branch)
     keeps TTS sentence-chunking from jamming — leave it.

5. **Pick the effect pattern and copy the closest existing tool:**
   - **Edge-executed (compute or server fetch)** → mirror `calcular`
     (`evaluateExpression`): pure, deterministic, **no `eval`/`Function`**,
     allowlisted operations. If it fetches, wrap it in an `AbortController`
     timeout exactly like `validateYouTubeVideo` / `fetchWeather` (~2.5–3s), and
     treat a timeout/5xx as "unknown → proceed", a 4xx as `isError: true` so the
     model self-corrects. Return `action: null`.
   - **Browser-effect (something must happen in the operator's browser)** →
     mirror `abrir_site` / `hud_display`: validate server-side (URLs stay
     **https-only**; IDs strictly regex-checked), return an `action` object, and
     **answer the `tool_result` yourself** so the loop never waits on the client.
     Then wire the client side — see `add-hud-action.md`.

6. **Before touching tool-version or model constants** (`web_search_20250305`,
   `resolveCommandConfig` model IDs): invoke the **`claude-api`** skill for the
   current, correct IDs. `web_search_20260209`+ requires newer models — don't
   bump the tool version without bumping the models in `resolveCommandConfig`.

## Verify

- Unit-test the executor in isolation via Node (the module is edge-safe/pure):
  import `executeTool` / `evaluateExpression` and assert on outputs.
- `npm run dev`, then exercise the tool through the chat UI and confirm the
  `jarvis_tool {status:'start'|'done'}` events fire and the model synthesizes the
  result in prose (doesn't dump JSON).
- Expect the `architecture-guardian` subagent to review the diff — it checks
  exactly items 1–4 above.
