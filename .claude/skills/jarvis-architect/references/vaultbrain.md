# Recipe: extend the VaultBrain (three.js) safely

VaultBrain is an imperative three.js scene (`src/lib/brain-scene.js`) driven by
`VaultBrain.jsx`, fed by the pure graph layer (`src/lib/vault-graph.js`) and the
`useVault` hook. It re-renders outside React. The failure modes here are subtle
(color washout, GPU leaks) and don't show up in a quick glance — follow the
checklist.

## Rendering invariants (per CLAUDE.md — the guardian checks these)

1. **Background via `scene.background`** (a managed `Color`), **never**
   `renderer.setClearColor` with a raw hex. The raw clear color bypasses color
   management, and `OutputPass` then washes the near-black to gray-blue.
2. **Keep both `UnrealBloomPass` and `OutputPass`** in the EffectComposer.
   `OutputPass` is required for correct color space through the composer — don't
   drop it when adding a pass.
3. **`dispose()` must stay exhaustively symmetric** with everything created
   (geometries, materials, textures, passes, event listeners). Dev StrictMode
   double-mounts, so leaks surface immediately. Every `new` needs a matching
   dispose.
4. **WebGL context loss** rebuilds the whole scene via `resetKey` — if you add
   persistent scene objects, make sure they're recreated on rebuild, not assumed.
5. **All assets procedural.** COEP `require-corp` blocks external textures/fonts —
   generate them in-code (no CDN/remote image loads).

## Performance invariants

6. The `d3-force-3d` simulation is ticked inside rAF with an **8ms/frame budget**
   and freezes after settling (~3–5s). Don't run an unbounded simulation.
7. Layout positions are cached in `vault.layoutCacheRef` keyed by `scanId` so
   re-entering VAULT mode skips re-simulation — preserve this if you touch layout.
8. `pruneGraph` caps rendering at 1500 nodes (top-800 by degree + neighbors).
   Large vaults depend on this — don't render the full graph.

## Privacy invariants (hard boundary)

See `CLAUDE.md` § "Vault Semantic Memory (Fase A)" → **Privacy invariant
(normative)** for the authoritative text. Summarized:

9. **The graph scan keeps metadata + link targets only** — `walkVault` discards
   note bodies after parsing wikilinks. `readNote(path)` re-reads a single file
   on demand; use it instead of retaining bodies in memory. (The semantic index
   is separate and *does* persist chunk text — see item 10.)
10. **Everything local stays local.** Chunking, embedding, and the semantic
    index (`jarvis-vault-index` in IndexedDB, which persists chunk text +
    vectors) run entirely in the browser. The model is self-hosted
    (`env.allowRemoteModels = false`) — **embeddings never leave the browser**
    for any external service.
11. **Note content reaches the network through exactly two sanctioned paths**:
    (a) the explicit "ANALISAR COM JARVIS" flow (`handleAnalyzeNote` in
    `App.jsx`, truncated at `MAX_TEXT_CHARS`); (b) short, retrieval-selected
    excerpts riding along with an explicit chat request to `/api/chat`, capped
    at the global 2000-char budget in `src/lib/memoryContext.js`. Full note
    bodies are **never** sent automatically.
12. **Never add a third path.** No sending the whole vault, whole note bodies,
    unselected notes, or the index itself to any endpoint — and never write full
    note bodies into persistent logs or telemetry.

## External three.js / d3-force-3d API questions

Don't guess API surface from memory — fetch it via **context7**
(`resolve-library-id` for `three` / `d3-force-3d`, then `query-docs`). Version
drift in three.js (pass constructors, color management) is exactly where this
scene breaks.

## Verify

- `npm run dev`, enter VAULT mode (`/vault`), connect a vault. Confirm the
  background stays near-black (not gray-blue), bloom looks right, and nodes
  settle then freeze.
- Watch for GPU/memory growth across a few mode switches (dev StrictMode makes
  leaks obvious) — a climbing memory profile means an asymmetric `dispose()`.
- Confirm no network request carries **full** note bodies. Expected traffic:
  retrieval-selected excerpts inside the `/api/chat` request body on each
  message (bounded by the 2000-char budget — cross-check against what
  `MemoryPanel` shows), plus one note's text on "ANALISAR COM JARVIS". Anything
  beyond those two is a regression; **the per-message excerpts are not**.
- Expect the `architecture-guardian` subagent to review — it checks items 1–3,
  and the Fase A semantic-memory invariants if your change touches the pipeline.
