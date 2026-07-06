# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server on port 5173
npm run build    # Production build → dist/
npm run preview  # Preview prod build locally
```

No lint or test scripts exist in this project.

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

### Key library files

- **`src/lib/anthropic.js`** — `callClaude(messages, { onChunk, onAction, onToolStatus })`: handles both streaming (SSE reader loop) and batch. Returns `{ text, jarvis, tokenUsage, actions }`. On a synthetic `error` event: throws if no text streamed yet, otherwise returns the partial text.
- **`src/lib/jarvis-tools.js`** — Tool definitions (`JARVIS_TOOLS`) + executors. Pure/edge-safe, unit-testable via Node. Contains the hand-rolled arithmetic parser (no `eval`) and the https-only URL validator/builders.
- **`src/lib/jarvis-prompts.js`** — `buildSystemPrompt(opts)`, `detectCommand(msg)`, `resolveCommandConfig(cmd)`. Command routing: `/profundo` → `claude-opus-4-8` with `deep: true`; default → `claude-sonnet-4-6`.
- **`src/lib/constants.js`** — Color palette (`C.*`) and font style objects (`display`, `mono`) used throughout all components.

### Chat flow

`App.jsx` → `useChat.submitCommand()` → POST `/api/chat` (`stream: true`) → Anthropic SSE → `callClaude` onChunk → `setStreamText` (live text) + TTS sentence feeding → final `sessionTokens` update from `jarvis_tokens` event.

### Tool use (server-side agentic loop)

`api/chat.js` always sends `tools: JARVIS_TOOLS` (stable module constant — tools precede `system` in the prompt-cache hierarchy, so a varying array would invalidate the cache). Three tools:

- **`web_search`** — Anthropic's native server tool (`web_search_20250305`, `max_uses: 5`). Anthropic executes the search and continues generation **in the same SSE stream**; no client/server executor. `web_search_20260209`+ requires Sonnet 4.6+/Opus 4.6+ — don't upgrade the tool version without bumping the models in `resolveCommandConfig`.
- **`calcular`** — custom tool executed in the Edge function (`evaluateExpression` in `jarvis-tools.js`): recursive-descent arithmetic parser, PT-BR decimal commas, allowlisted functions.
- **`abrir_site`** — custom tool whose *effect* happens in the browser: the Edge function validates the URL (https-only), emits a `jarvis_action {action:'open_url', url, label}` SSE event, and answers the `tool_result` itself so the loop never waits on the client. `useChat.onAction` best-efforts `window.open` and **always** appends a clickable `{type:'action'}` history chip (popup blockers block voice-initiated opens).

Loop mechanics (streaming branch): the first Anthropic call happens **before** the `Response` is constructed (real HTTP errors preserve the client's 429 backoff). A manual `ReadableStream` then pumps each upstream SSE body — forwarding every raw line to the client while reconstructing content blocks (`pumpMessage`) — and on `stop_reason: 'tool_use'` executes tools, appends the assistant turn + one `user` message with all `tool_result`s, and re-calls Anthropic into the same client stream (`MAX_ITERATIONS = 5`; `pause_turn` re-calls with the assistant blocks echoed verbatim). A synthetic `"\n\n"` text delta separates loop phases so TTS sentence-chunking doesn't jam. Intermediate tool turns live only inside one request — the client's `apiHistory` stays plain text. Tool prose guidance lives in `JARVIS_TOOLS_INTRO` + `JARVIS_TOOLS_CATALOG` (`jarvis-prompts.js`); JSON schemas live only in `jarvis-tools.js`.

### Local commands (no API call)

`useChat.handleLocalCommand()` intercepts `/status`, `/briefing`, `/ajuda`, `/holo`, `/armor`, `/terminal`, `/foco`, `/sair` client-side before hitting the API.

### VAD & WASM assets

`vite.config.js` uses `vite-plugin-static-copy` to copy 6 ONNX/worklet files to `dist/` root so VAD initializes correctly in production. `useMicVAD` must use `baseAssetPath: '/'` and `onnxWASMBasePath: '/'`. COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`) are set in both `vite.config.js` (dev) and `vercel.json` (prod) — required for `SharedArrayBuffer` / WASM threading.

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
