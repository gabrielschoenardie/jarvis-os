# Agent registry

All agents are peers dispatched directly by the Orchestrator (you/Claude in
the main session). None of them call each other — there is no agent-to-agent
invocation in this project. When a narrow agent turns up something outside
its own remit, it reports back to the Orchestrator, who then decides whether
to dispatch a different agent.

| Agent | Model | Effort | Tools | Trigger |
|---|---|---|---|---|
| `scout_worker` | Haiku | low | Read, Grep, Glob, Bash | Diagnosing Vite/Vercel logs, build errors, dependency issues |
| `security-reviewer` | Sonnet | — | Read, Grep, Glob, Bash | After changes to `api/*.js`, `src/lib/jarvis-tools.js`, `src/lib/anthropic.js`, or before a release |
| `architecture-guardian` | Sonnet | — | Read, Grep, Glob, Bash | After changes to `api/chat.js`, `src/lib/jarvis-tools.js`, `src/lib/jarvis-prompts.js`, `src/lib/brain-scene.js`, `vite.config.js`, `vercel.json` |
| `performance-monitor` | Haiku | low | Read, Grep, Glob, Bash | After changes to `api/chat.js`, `src/lib/jarvis-tools.js`, `src/lib/jarvis-prompts.js`, `vite.config.js`, `vercel.json` — checks prompt-cache and VAD/COOP-COEP regressions |
| `ui_graph_worker` | Sonnet | low | (full) | Implementing React/Three.js/D3 per an Orchestrator-designed spec |
| `ai_ml_worker` | Sonnet | low | (full) | Implementing ONNX/VAD/Anthropic API integration per an Orchestrator-designed spec |

## Escalation pattern

```
Orchestrator
 ├─ scout_worker          (read-only diagnosis)
 │   └─ finding looks architectural  → Orchestrator dispatches architecture-guardian
 │   └─ finding looks security-shaped → Orchestrator dispatches security-reviewer
 ├─ architecture-guardian  (read-only review, narrow invariant checks)
 ├─ security-reviewer      (read-only review, narrow security checks)
 ├─ performance-monitor    (read-only review, cache/bundle/header checks)
 ├─ ui_graph_worker        (writes code, from an Orchestrator-authored spec)
 └─ ai_ml_worker           (writes code, from an Orchestrator-authored spec)
```

No agent is authorized to invoke another agent. All escalation happens by the
narrow agent finishing its report and the Orchestrator choosing the next
dispatch.

## Invariant ownership

The actual invariant text lives in `CLAUDE.md` — this table only says who
checks what and where to go read the real definition. Don't duplicate the
invariant text here; update CLAUDE.md and this table stays correct by
reference.

| Invariant | Documented in `CLAUDE.md` | Checked by |
|---|---|---|
| API keys never reach the browser bundle | Environment variables table | `security-reviewer` |
| `abrir_site` is https-only, server validates | Tool use § `abrir_site` | `security-reviewer`, `architecture-guardian` |
| `calcular` parser never gains `eval`/`Function` | Key library files § `jarvis-tools.js` | `security-reviewer` |
| `hud_display` ID validation + oEmbed timeout semantics | Tool use § `hud_display` | `security-reviewer`, `architecture-guardian` |
| Vault note bodies never leave the browser except via explicit analyze action | Obsidian vault brain § privacy | `security-reviewer` |
| `JARVIS_TOOLS` stable + precedes `system` (prompt cache) | Tool use (server-side agentic loop), intro paragraph | `architecture-guardian`, `performance-monitor` |
| Tool schemas only in `jarvis-tools.js`, prose only in `jarvis-prompts.js` | Tool use, closing paragraph | `architecture-guardian` |
| `executeTool` stays `async`/awaited | Tool use, closing paragraph | `architecture-guardian` |
| COOP/COEP headers present in both `vite.config.js` and `vercel.json` | VAD & WASM assets | `architecture-guardian`, `performance-monitor` |
| three.js scene hygiene (`scene.background`, symmetric `dispose()`, Bloom+OutputPass) | Obsidian vault brain § `brain-scene.js` | `architecture-guardian` |
