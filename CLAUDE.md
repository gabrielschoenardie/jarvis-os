# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server on port 5173
npm run build        # Production build → dist/
npm run preview      # Preview prod build locally
npm test             # node --test — the pure lib modules (see below)
npm run lint:design  # scripts/design-lint.mjs — headless HUD design rules
```

`npm test` runs Node's built-in runner over the `*.test.js` files colocated in
`src/lib/` (`chunker`, `memoryContext`, `vectorIndex`). There is no test
framework and no DOM/component testing — only the pure, dependency-free
modules are covered. `npm run lint:design` enforces the five HUD rules from
`docs/HUD_AUDIT_PLAN.md` (see `scripts/design-lint.mjs`); a rule not yet
closed by its phase runs in informative mode instead of failing the script.

Both are validation gates, not optional: run them alongside `npm run build`
before committing.

## Orchestration — Metodologia Gabriel

As the Orchestrator of JARVIS OS, you must strictly follow the Metodologia Gabriel for every task:

1. **Analysis**: Use the `scout_worker` (Haiku) to read logs, map state, and analyze Vite/React errors. Use `performance-monitor` (Haiku) after changes near the tool loop, prompt caching, or VAD/COOP-COEP config to catch cache-invalidation or voice-input regressions.
2. **Planning**: Design the AI/ML architecture, state management for Voice/Three.js, and API security.
3. **Implementation**: Delegate coding entirely to `ui_graph_worker` or `ai_ml_worker` (Sonnet 5).
4. **Validation**: Review workers' code to ensure it meets requirements and runs flawlessly in the browser/Vercel. `architecture-guardian` and `security-reviewer` (Sonnet) run proactively against their own trigger conditions — see each agent's `description` — to check the diff before it's committed or merged.
5. **Documentation**: Record the architectural decisions and updates in the repository's memory.

Never waste Fable 5 tokens typing repetitive React boilerplate or reading raw Vite logs.

See `.claude/agents/README.md` for the full agent registry and escalation pattern.

## Architecture

**JARVIS OS** is a voice-first AI assistant interface (React + Vite) deployed on Vercel.

### Runtime split

- **`api/chat.js`** — Vercel **Edge** runtime. Proxies to Anthropic Claude API with SSE streaming and runs the **server-side agentic tool loop** (see "Tool use"). Emits synthetic SSE events: `jarvis_tokens` (token accounting summed across all loop iterations, at stream end), `jarvis_tool` (`{name, status: 'start'|'done'}`), `jarvis_action` (browser-side effects), and `error` (mid-loop upstream failures after headers are sent).
- **`api/tts.js`**, **`api/stt-token.js`**, **`api/voices-list.js`** — Vercel **Node** runtime. Handle ElevenLabs TTS streaming, single-use Scribe WebSocket tokens, and voice catalog caching.

All API keys (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`) live server-side only — never in the browser bundle.

### Frontend hook architecture

| Hook | Role |
|------|------|
| `useChat` | Conversation history (API + UI), `submitCommand`, 429 retry backoff, `sessionTokens` accumulator, `localStorage` persistence |
| `useTelemetry` | Live latency counter (`startTimer`/`stopTimer` at 100ms) with EMA smoothing |
| `useSpeechInput` | VAD via `@ricky0123/vad-react` + ONNX WASM → ElevenLabs Scribe WebSocket (PT-BR) |
| `useSpeech` | Orchestrates `useSpeechInput` + `useElevenLabsTTS`, exposes unified speech API to `App` |
| `useElevenLabsTTS` | ElevenLabs TTS proxy, queued playback, Web Speech API fallback |

### Component map

Top-level (`src/components/`):

- **`PresenceCore.jsx`** — the signature arc-reactor (SVG/CSS, no three.js), floating hero above the command input in terminal mode. Its visual state (`idle`/`listening`/`thinking`/`speaking`/`tool`) derives from `thinking`/`speaking`/`listening`/`toolStatus` — motion *is* the assistant state machine. Same "core" idiom as the VAULT 3D nucleus: one being, two projections. Decorative (`pointerEvents:none`, `role="img"` + `aria-label`).
- **`TerminalView.jsx`** — conversation transcript; memoized history rows + `React.memo` `AIText` (Fase 2 render isolation). Renders `WeatherCard`.
- **`VaultBrain.jsx`** — VAULT 3D graph host (lazy). See the vault section below.
- **`VoicePanel.jsx` / `VoiceIndicator.jsx`** — voice controls; `VoiceIndicator` exports `VoiceIndicator`/`ToggleBtn`/`MicButton`. Voice-unsupported browsers show a "voz não suportada" affordance (gated by `voiceSupported` in `useSpeechInput.js`).
- **`WeatherCard.jsx`** — interactive SVG forecast card (see weather section).
- **`HudMediaWindow.jsx`** — floating YouTube overlay (see `hud_display`). Manages keyboard focus on open/close.
- **`Meter.jsx`** — HUD bar meter (`max`/clamp via `clampPct`).
- **`ErrorBoundary.jsx`** — wraps the lazy `VaultBrain` in `App.jsx` so a three.js crash doesn't take down the app.

HUD primitives (`src/components/hud/`, barrel `index.js`): **`Corners`** (corner brackets — the exclusive mark of projected/glass surfaces), **`HoloPanel`** (glass panel wrapper), **`HudButton`**, **`HudLabel`** — deduped from ~15 inline variants in Fase 1.

Responsive layout classes live in an inline `<style>` block in `App.jsx`: **`.jv-layout`** (3-column grid → 2-col <1280 → 1-col <900), **`.jv-rail-left`**/**`.jv-rail-right`** (collapse at those breakpoints), **`.jv-cmd`**/**`.jv-cmd-hints`** (command-row paddings/hints), **`.jv-holo-glass`** (glass surface, mirrored by the `glass` token). A global `@media (prefers-reduced-motion: reduce)` block there zeroes CSS animation/transition durations; JS-driven motion (three.js, boot staging) checks `matchMedia` directly.

### Key library files

- **`src/lib/anthropic.js`** — `callClaude(messages, { onChunk, onAction, onToolStatus })`: handles both streaming (SSE reader loop) and batch. Returns `{ text, jarvis, tokenUsage, actions }`. On a synthetic `error` event: throws if no text streamed yet, otherwise returns the partial text.
- **`src/lib/jarvis-tools.js`** — Tool definitions (`JARVIS_TOOLS`) + executors. Pure/edge-safe, unit-testable via Node. Contains the hand-rolled arithmetic parser (no `eval`) and the https-only URL validator/builders.
- **`src/lib/jarvis-prompts.js`** — `buildSystemPrompt(opts)`, `detectCommand(msg)`, `resolveCommandConfig(cmd)`. Command routing: `/profundo` → `claude-opus-4-8` with `deep: true`; default → `claude-sonnet-4-6`.
- **`src/lib/constants.js`** — Design-token single source of truth (Fase 1). Exports: `C` (color palette; `C.accent` `#00d4ff` is the sole protagonist, plus `bgSoft`/`bgDeep` void stops), `display`/`mono` (font style objects), `z` (z-index layers — no magic z-index elsewhere), `motion` (durations 150/300/450ms + easings), `space`, `radius`, `glass` (glass-surface style object mirroring the `.jv-holo-glass` class), `type` (typography presets: `eyebrow`/`micro`/`label`), `MODEL` (single-source UI model label — keep aligned with `resolveCommandConfig` in `jarvis-prompts.js`, the runtime source of truth), `clampPct(v)` (0–100 clamp for meters).

### Chat flow

`App.jsx` → `useChat.submitCommand()` → POST `/api/chat` (`stream: true`) → Anthropic SSE → `callClaude` onChunk → `setStreamText` (live text) + TTS sentence feeding → final `sessionTokens` update from `jarvis_tokens` event.

### Tool use (server-side agentic loop)

`api/chat.js` always sends `tools: JARVIS_TOOLS` (stable module constant — tools precede `system` in the prompt-cache hierarchy, so a varying array would invalidate the cache). Four tools:

- **`web_search`** — Anthropic's native server tool (`web_search_20250305`, `max_uses: 5`). Anthropic executes the search and continues generation **in the same SSE stream**; no client/server executor. `web_search_20260209`+ requires Sonnet 4.6+/Opus 4.6+ — don't upgrade the tool version without bumping the models in `resolveCommandConfig`.
- **`calcular`** — custom tool executed in the Edge function (`evaluateExpression` in `jarvis-tools.js`): recursive-descent arithmetic parser, PT-BR decimal commas, allowlisted functions.
- **`abrir_site`** — custom tool whose *effect* happens in the browser: the Edge function validates the URL (https-only), emits a `jarvis_action {action:'open_url', url, label}` SSE event, and answers the `tool_result` itself so the loop never waits on the client. `useChat.onAction` best-efforts `window.open` and **always** appends a clickable `{type:'action'}` history chip (popup blockers block voice-initiated opens).
- **`hud_display`** — shows a YouTube video in a floating window over the HUD. The Edge function extracts/validates the 11-char video ID (`extractYouTubeId`) and confirms embeddability via YouTube's public oEmbed endpoint (no API key, ~3s `AbortController` timeout; 4xx → `is_error` so the model self-corrects, timeout/5xx → proceeds with model-supplied title), then emits `jarvis_action {action:'hud_video', videoId, url, title, channel}`. `useChat` sets `hudMedia` state (live window, never persisted) and appends a `{type:'hud'}` reopen chip (persisted). `HudMediaWindow.jsx` renders the fixed overlay (z-50, `hudIn`/`hudOut` animations, ESC-close). Typical flow is an agentic chain: `web_search` finds the exact watch URL → `hud_display` embeds it.

**`executeTool` is `async`** (both api/chat.js branches `await` it) — tools may do network I/O.

Loop mechanics (streaming branch): the first Anthropic call happens **before** the `Response` is constructed (real HTTP errors preserve the client's 429 backoff). A manual `ReadableStream` then pumps each upstream SSE body — forwarding every raw line to the client while reconstructing content blocks (`pumpMessage`) — and on `stop_reason: 'tool_use'` executes tools, appends the assistant turn + one `user` message with all `tool_result`s, and re-calls Anthropic into the same client stream (`MAX_ITERATIONS = 5`; `pause_turn` re-calls with the assistant blocks echoed verbatim). A synthetic `"\n\n"` text delta separates loop phases so TTS sentence-chunking doesn't jam. Intermediate tool turns live only inside one request — the client's `apiHistory` stays plain text. Tool prose guidance lives in `JARVIS_TOOLS_INTRO` + `JARVIS_TOOLS_CATALOG` (`jarvis-prompts.js`); JSON schemas live only in `jarvis-tools.js`.

### Local commands (no API call)

`useChat.handleLocalCommand()` intercepts `/status`, `/briefing`, `/ajuda`, `/vault`, `/holo`, `/armor`, `/terminal`, `/foco`, `/sair` client-side before hitting the API.

### Obsidian vault brain (VAULT mode)

The `'holographic'` mode slot renders `VaultBrain.jsx` (default export, mounted via `React.lazy` — the three.js chunk ~540kB only loads on first VAULT entry; `optimizeDeps.include` lists `three`/`d3-force-3d` to avoid a dev-server full reload). It replaced the old SVG arc-reactor `HolographicView`; that arc-reactor idiom now lives on as **`PresenceCore`** (the terminal-mode projection of the same core the VAULT nucleus renders in 3D). It's wrapped in `ErrorBoundary` so a WebGL/three.js crash can't take down the app.

- **`src/hooks/useVault.js`** (lives in `App` — survives mode switches): connects the user's local Obsidian vault via the File System Access API (`showDirectoryPicker`, Chromium-only — acceptable, VAD already requires Chromium). The directory handle persists in IndexedDB (`src/lib/idb.js`, db `jarvis-os`/store `kv`, key `jarvis-vault-handle`); on reload, `queryPermission === 'granted'` auto-rescans, `'prompt'` shows a one-click RECONECTAR (needs a user gesture). Status machine: `unsupported | idle | permission | scanning | ready | error`. Scan walks `.md` files (skips dot-dirs, 4000-file cap, >2MB files skip link parsing, yields every 25 files), parses `[[wikilinks]]`, then **discards note bodies** — only metadata + link targets stay in memory. `readNote(path)` re-reads one file fresh on demand. **Privacy: the scan/index walk itself is 100% client-side** (only metadata + link targets are read during the initial vault scan). Note content reaches the network in three ways: (1) the explicit "ANALISAR COM JARVIS" action on a single note (`handleAnalyzeNote` in `App.jsx`, truncated at `MAX_TEXT_CHARS`); (2) automatically, on every chat message, as short excerpts of whichever notes are most relevant — via semantic search when the local index is ready, or via recency (the 5 most-recently-modified notes) as a fallback — capped at 2000 characters total (`src/lib/memoryContext.js`); (3) full note bodies are chunked, embedded, and the resulting text+vectors persisted to IndexedDB (`jarvis-vault-index`) for the semantic index — this stays local (embeddings never leave the browser), but it IS a change from the old "bodies are discarded after scan" behavior for notes the index has processed. See "Vault Semantic Memory (Fase A)" below.
- **`src/lib/vault-graph.js`** — pure/Node-testable: `parseWikilinks` (strips code fences; `![[embeds]]` count, media extensions don't; `[[Note|alias]]`/`[[Note#h]]` cleaned), resolution by lowercase basename (duplicate basenames: first wins — approximation of Obsidian's shortest-path rule), unresolved targets become faint ghost nodes. `pruneGraph` caps rendering at 1500 nodes (top-800 by degree + neighbors, "EXIBINDO N/M" shown in metrics). `computeMetrics` feeds the HUD panels (notes/links/orphans/total words).
- **`src/lib/brain-scene.js`** — imperative three.js scene (no React re-renders): `Points` + custom ShaderMaterial (per-node size ∝ √degree, additive blending, twinkle), `LineSegments` links that brighten on hover/selection, UnrealBloomPass + **OutputPass** (required for correct color space through EffectComposer), arc-reactor nucleus (pulses fast on `thinking`, ripple sphere while `speaking`), `d3-force-3d` simulation ticked inside rAF with an 8ms/frame budget (organic settle ~3-5s, then frozen; nodes pushed outside the r=22 nucleus zone). Camera focus tween on node select; click-vs-drag disambiguated by 5px displacement. Layout positions cached in `vault.layoutCacheRef` keyed by `scanId` so mode re-entry skips re-simulation. **Set the background via `scene.background` (managed `Color`), never `setClearColor` raw hex** — the raw clear color bypasses color management and OutputPass washes the near-black to gray-blue. `dispose()` is exhaustively symmetric (StrictMode double-mounts in dev). WebGL context loss → overlay + full scene rebuild via `resetKey`. All assets procedural (COEP `require-corp` blocks external textures).

### Vault Semantic Memory (Fase A)

Local semantic search over the vault, so `memoryContext` picks notes by relevance instead of only recency. Fully client-side; degrades silently to the pre-existing recency mechanism if anything fails.

- **`src/lib/chunker.js`** — pure: `chunkText(rawText)` strips frontmatter and splits the body into ~900-char chunks with ~150-char overlap, preferring a paragraph (`\n\n`) or heading (`#`) break in the final half of each window over a hard cut.
- **`src/lib/vectorIndex.js`** — pure: `diffIndex(graph, index)` diffs the current graph against the persisted index by `mtime` to find notes needing (re)embedding vs. removal; `packVectors`/`unpackVector` pack per-chunk `Float32Array`s into one contiguous buffer; `search(index, queryVec, k)` is brute-force dot product (vectors are pre-normalized, so dot product == cosine) — fast enough in JS at vault scale, no ANN needed.
- **`src/workers/embedder.worker.js`** + **`src/lib/embedder.js`** — runs `@huggingface/transformers` (`Xenova/multilingual-e5-small`, `q8` quantized) inside a dedicated Web Worker, isolated from VAD's own separate `onnxruntime-web` instance on the main thread. The model is self-hosted at `public/models/` (fetched by `scripts/fetch-embedding-model.mjs` via `postinstall`; gitignored, never committed — `env.allowRemoteModels = false` at runtime too). Its WASM assets are served from `/embedder-wasm/`, **not** `/` — `@huggingface/transformers` bundles its own pinned `onnxruntime-web` version with WASM files identically named to VAD's (`ort-wasm-simd-threaded.*`); sharing `/` would silently load the wrong binary under the wrong JS glue (see `vite.config.js`'s `viteStaticCopy` targets). `embedder.js`'s `call()` timeout is split in two: `warmup()` (cold model load, can fetch+init ~135MB on first run) gets a 120s budget; `embed` calls against an already-warm worker keep the original 15s — a worker crash (`onerror`) rejects all pending calls and terminates the dead worker so the ~118MB model isn't leaked in memory.
- **`src/hooks/useVaultIndex.js`** — orchestrates incremental indexing (diffed by `mtime` against the previous scan, batched embedding of only changed notes) and hybrid search (`0.75×cosine + 0.25×recency`, 30-day half-life, best chunk per note deduped). Persists the packed index to IndexedDB (`jarvis-vault-index`). An embed failure mid-loop is caught and falls back to `indexStatus: 'unavailable'` rather than leaving the UI stuck on "indexing" — same handling as a `warmup()` failure.
- **Graceful degradation**: `indexStatus` (`idle | loading-model | indexing | ready | unavailable`) — any non-`'ready'` state, or a `searchMemory` failure, falls back to the pre-existing recency-only selection (`selectRecentNotes` in `memoryContext.js`). Chat never breaks or surfaces an error for this.
- **Privacy invariant (normative)** — the rule the reviewers enforce, superseding the pre-Fase-A "note bodies only leave via ANALISAR COM JARVIS" phrasing:
  1. Scanning the vault, chunking, embedding, and the index itself stay **local**. The model is self-hosted (`env.allowRemoteModels = false`); **embeddings never leave the browser** for any external service.
  2. Full note bodies are **never** sent automatically. Only short, retrieval-selected excerpts may accompany an **explicit** chat request to `/api/chat`.
  3. That automatic context is capped by the global `MAX_TOTAL_CHARS = 2000` budget in `memoryContext.js`, applied in the shared `selectParts` so `buildMemoryContext` (what the model gets) and `buildMemoryDetail` (what `MemoryPanel` shows) can never diverge.
  4. The explicit "ANALISAR COM JARVIS" flow (`handleAnalyzeNote` in `App.jsx`) remains permitted under its own `MAX_TEXT_CHARS` limit.
  5. No new code path may send the whole vault, whole note bodies, unselected notes, or the index to the network — and full note bodies must never be written to persistent logs or telemetry.
- `npm test` (`node --test`) covers the three pure modules — `chunker.js`, `vectorIndex.js`, `memoryContext.js` — the project's first automated test coverage.

### VAD & WASM assets

`vite.config.js` uses `vite-plugin-static-copy` to copy 6 ONNX/worklet files to `dist/` root so VAD initializes correctly in production. `useMicVAD` must use `baseAssetPath: '/'` and `onnxWASMBasePath: '/'`. COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) are set in both `vite.config.js` (dev) and `vercel.json` (prod) — required for `SharedArrayBuffer` / WASM threading. **Never remove `require-corp`** — it is load-bearing for VAD. It also blocks cross-origin iframes: the YouTube embed in `HudMediaWindow.jsx` only loads via the `credentialless` iframe attribute (Chromium-only, feature-detected; fallback renders an external link instead of the player).

### Real-time weather context

`api/chat.js` gates on `isWeatherQuery(cleanMessage)` from `src/lib/weather.js` (keyword/phrase match, PT-BR). When matched, it reads Vercel's IP-geolocation headers (`x-vercel-ip-latitude`, `x-vercel-ip-longitude`, `x-vercel-ip-city`, `x-vercel-ip-country` — auto-injected on every Edge request in Production/Preview, absent in local `vite dev`) and calls `fetchWeather()` (Open-Meteo, no API key, `AbortController` timeout ~2.5s). Result is appended as a **second, uncached** `system` block (`JARVIS_WEATHER_INTRO` + `formatWeatherContext(...)`) so the existing cached identity/domain block isn't invalidated on weather turns. If no weather block is present, a `JARVIS_GUARDRAILS` line instructs JARVIS to say it has no real-time access rather than invent a forecast.

**Visual forecast card**: on weather turns, `useChat` also fires a parallel client-side GET to `api/weather.js` (Edge, same geo headers, `fetchForecast()` — 7-day daily + 48h hourly). When it resolves, a `{ type: 'weather', forecast }` history entry is appended after the AI response; `TerminalView` renders it as `WeatherCard.jsx` (hand-rolled interactive SVG: temperature curve with crosshair tooltip, rain/wind bar tabs, 7-day strip). Endpoint failure is silent — no card, spoken answer still covers it.

### History & context limits

- API history truncated to last 40 messages (20 turns) in `api/chat.js` before sending to Anthropic.
- `localStorage['jarvis-history']` stores up to 20 API turns + 60 UI turns, restored on mount.
- System prompt uses `cache_control: { type: 'ephemeral' }` for Anthropic prompt caching.

## Environment variables

| Variable | Runtime | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | Server | Claude API access |
| `ELEVENLABS_API_KEY` | Server | ElevenLabs TTS + STT Scribe token |
