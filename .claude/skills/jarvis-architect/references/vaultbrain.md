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

## Privacy invariant (hard boundary)

9. The scan keeps **metadata + link targets only** — note bodies are discarded
   after parsing. Note content is 100% client-side and may leave the browser
   **only** through the explicit "ANALISAR COM JARVIS" flow (`handleAnalyzeNote`
   in `App.jsx`, truncated at `MAX_TEXT_CHARS`). Never add a path that sends note
   bodies to any endpoint outside that flow. `readNote(path)` re-reads a single
   file on demand — use it instead of retaining bodies in memory.

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
- Confirm no network request carries note bodies except on "ANALISAR COM JARVIS".
- Expect the `architecture-guardian` subagent to review — it checks items 1–3.
