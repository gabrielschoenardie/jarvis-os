# Agent registry

All agents are peers dispatched directly by the Orchestrator (you/Claude in
the main session). None of them call each other — there is no agent-to-agent
invocation in this project. When a narrow agent turns up something outside
its own remit, it reports back to the Orchestrator, who then decides whether
to dispatch a different agent.

| Agent | Model | Effort | Tools | Trigger |
|---|---|---|---|---|
| `scout_worker` | Haiku | low | Read, Grep, Glob, Bash | Diagnosing Vite/Vercel logs, build errors, dependency issues |
| `security-reviewer` | Sonnet | — | Read, Grep, Glob, Bash | After changes to `api/*.js`, `src/lib/jarvis-tools.js`, `src/lib/anthropic.js`, the vault privacy boundary (`src/hooks/useVault.js`, `src/hooks/useVaultIndex.js`, `src/lib/memoryContext.js`), or before a release |
| `architecture-guardian` | Sonnet | — | Read, Grep, Glob, Bash | After changes to `api/chat.js`, `src/lib/jarvis-tools.js`, `src/lib/jarvis-prompts.js`, `src/lib/brain-scene.js`, `vite.config.js`, `vercel.json`, **or any semantic-memory pipeline file** (see below) |
| `performance-monitor` | Haiku | low | Read, Grep, Glob, Bash | After changes to `api/chat.js`, `src/lib/jarvis-tools.js`, `src/lib/jarvis-prompts.js`, `vite.config.js`, `vercel.json`, **or any semantic-memory pipeline file** — checks prompt-cache, VAD/COOP-COEP, and indexing/main-thread regressions |
| `ui_graph_worker` | Sonnet | low | (full) | Implementing React/Three.js/D3 per an Orchestrator-designed spec |
| `ai_ml_worker` | Sonnet | low | (full) | Implementing ONNX/VAD, local semantic memory (embeddings, chunking, vector index, Worker, IndexedDB, memory-context), and — when explicitly in scope — Anthropic API integration, per an Orchestrator-designed spec |

### Semantic-memory pipeline files (Fase A)

Shared trigger set for `architecture-guardian` and `performance-monitor`, and
the implementation surface for `ai_ml_worker`:

`src/hooks/useVault.js` · `src/hooks/useVaultIndex.js` · `src/lib/chunker.js` ·
`src/lib/vectorIndex.js` · `src/lib/memoryContext.js` · `src/lib/embedder.js` ·
`src/workers/embedder.worker.js` · `src/components/MemoryPanel.jsx`

## Escalation pattern

```
Orchestrator
 ├─ scout_worker          (read-only diagnosis)
 │   └─ finding looks architectural  → Orchestrator dispatches architecture-guardian
 │   └─ finding looks security-shaped → Orchestrator dispatches security-reviewer
 ├─ architecture-guardian  (read-only review, narrow invariant checks)
 ├─ security-reviewer      (read-only review, narrow security checks)
 ├─ performance-monitor    (read-only review, cache/header/semantic-memory checks)
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
| Vault privacy boundary: local scan/index/embeddings; only retrieval-selected excerpts (≤2000 chars) or the explicit analyze flow leave the browser | Obsidian vault brain § privacy + Vault Semantic Memory § privacy invariant | `security-reviewer`, `architecture-guardian` |
| Embedding model identity: `Xenova/multilingual-e5-small`, `q8`, 384 dims | Vault Semantic Memory (Fase A) | `architecture-guardian`, `ai_ml_worker` |
| E5 `query:`/`passage:` prefixes, mean pooling, `normalize: true` | Vault Semantic Memory (Fase A) | `architecture-guardian`, `ai_ml_worker` |
| Index schema `{version, model, dims}` guarded; incompatible index discarded and rebuilt | Vault Semantic Memory § `useVaultIndex.js` | `architecture-guardian` |
| Indexing stays incremental (diff by `mtime`), never a full re-embed per scan | Vault Semantic Memory § `vectorIndex.js` / `useVaultIndex.js` | `architecture-guardian`, `performance-monitor` |
| Recency fallback always reachable; memory failures never break chat | Vault Semantic Memory § graceful degradation | `architecture-guardian`, `performance-monitor` |
| Embedding runs only in the Worker; WASM served from `/embedder-wasm/`, not `/` | Vault Semantic Memory § `embedder.worker.js` | `architecture-guardian`, `performance-monitor` |
| `MemoryPanel` shares `selectParts` with `memoryContext` — no divergent logic | Vault Semantic Memory § `memoryContext.js` | `architecture-guardian`, `performance-monitor` |
| Warmup (120s) stays separate from the warm embed timeout (15s) | Vault Semantic Memory § `embedder.js` | `performance-monitor` |
| `JARVIS_TOOLS` stable + precedes `system` (prompt cache) | Tool use (server-side agentic loop), intro paragraph | `architecture-guardian`, `performance-monitor` |
| Tool schemas only in `jarvis-tools.js`, prose only in `jarvis-prompts.js` | Tool use, closing paragraph | `architecture-guardian` |
| `executeTool` stays `async`/awaited | Tool use, closing paragraph | `architecture-guardian` |
| COOP/COEP headers present in both `vite.config.js` and `vercel.json` | VAD & WASM assets | `architecture-guardian`, `performance-monitor` |
| three.js scene hygiene (`scene.background`, symmetric `dispose()`, Bloom+OutputPass) | Obsidian vault brain § `brain-scene.js` | `architecture-guardian` |
