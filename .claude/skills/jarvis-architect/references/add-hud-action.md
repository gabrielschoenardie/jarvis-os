# Recipe: add a browser-effect (jarvis_action) end-to-end

For a tool whose *effect* happens in the operator's browser (open a tab, show an
overlay). The Edge function validates + emits an SSE `jarvis_action` and answers
the `tool_result` itself; the client applies the effect and leaves a durable
chip. Mirror `abrir_site` (`open_url`) or `hud_display` (`hud_video`).

## Server side (Edge)

1. Do the tool schema + executor steps in `add-a-tool.md` first. The executor
   branch in `executeTool` (`src/lib/jarvis-tools.js`) must:
   - **Validate server-side** — never trust model input. URLs stay https-only
     (`resolveOpenUrl` rejects non-https, credentials-in-URL); IDs are strictly
     regex-matched (`extractYouTubeId` → `/^[A-Za-z0-9_-]{11}$/`). Reject → return
     `{ isError: true, action: null }` so the model self-corrects.
   - Return `action: { action: 'sua_acao', ...payload }` alongside a `resultText`
     that **describes the request as sent** (e.g. "sent to the console"), not a
     claim the browser did it — popup blockers may block a voice-initiated open.
2. `api/chat.js` already forwards `action` as `send({ type: 'jarvis_action', ...action })`
   and pushes the `tool_result` in the same turn — no loop wait on the client.
   You don't modify the loop; it's generic over `action`.

## Client side

3. **Apply the effect → `onAction(ev)` in `src/hooks/useChat.js`.** Add an
   `if (ev.action === 'sua_acao') { … }` branch. Follow the two existing shapes:
   - Fire the effect (`window.open` for `open_url`; `setHudMedia(...)` live state
     for `hud_video`).
   - **Always append a persisted history chip** so the effect survives reload and
     voice-blocked popups: `setHistory(h => [...h, { role:'jarvis', type:'action'|'hud'|…, …, ts:new Date() }])`.
     Live-window state (`hudMedia`) is **never persisted** — only the chip is.
4. **Renderer.** If it's an overlay, add/extend a component like
   `HudMediaWindow.jsx` and render it from `App` off the live state. Add a
   `TOOL_LABELS` entry in `useChat.js` for the status pill.
5. **Cross-origin iframe? Mind COEP.** COEP is `require-corp` (load-bearing for
   VAD — never remove it), which blocks cross-origin iframes. Load them via the
   `credentialless` attribute, feature-detected, with an external-link fallback
   when unsupported — exactly as `HudMediaWindow.jsx` does for the YouTube embed.

## Verify

- `npm run dev`, trigger the tool by voice/text. Confirm: the SSE `jarvis_action`
  arrives, the effect happens, and a clickable chip lands in history.
- Reload the page — the chip persists; the live overlay does not (re-openable
  from the chip).
- Popup case: block popups and confirm the chip still gives the operator the
  action (the guaranteed path).
