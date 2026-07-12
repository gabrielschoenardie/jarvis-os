Feature: color the Vault 3D graph nodes and links by domain, read from each
note's YAML frontmatter `domain` field. Currently every node and link renders
in a single cyan accent color (ACCENT = 0x00d4ff) — I want hub clusters
visually distinguishable by hue, matching this palette:

  jarvis-os-core:      0x22e6ff  (cyan — keep as the core/default color)
  architecture:         0x3b82f6  (blue)
  ai-models:            0xa855f7  (purple)
  prompt-engineering:   0xf59e0b  (amber)
  automation:           0x2dd4bf  (teal)
  memory-system:        0x34d399  (green)
  principles:           0xa3e635  (lime)
  knowledge-base:       0x38bdf8  (sky blue)
  video-engineering:    0xf43f5e  (rose)
  photography:          0xec4899  (pink)

Notes with no `domain` field, an unrecognized domain, or ghost nodes should
fall back to the current ACCENT cyan — don't break rendering for vaults
that don't use this frontmatter convention.

Three files change, in this order:

## 1. src/hooks/useVault.js — extract `domain` from frontmatter

In `walkVault()`, alongside the existing `parseWikilinks(text)` call (the
branch that already reads `file.text()` when under MAX_PARSE_BYTES), add a
lightweight frontmatter extractor — no YAML library, just enough to pull one
field. Add a small helper near the top of the file:

```js
function extractDomain(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = text.slice(3, end);
  const m = fm.match(/^domain:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}
```

Then in the `else` branch of walkVault (where `text` is already read), call
`const domain = extractDomain(text);` and add `domain` to the object pushed
into `files`. For the large-file branch (`file.size > MAX_PARSE_BYTES`),
set `domain = null` — don't read those files twice.

## 2. src/lib/vault-graph.js — thread `domain` into node objects

In `buildGraph()`, where the node object is constructed
(`const node = { id: f.path, title, path: f.path, size: f.size, words: f.words, mtime: f.mtime, degree: 0 };`),
add `domain: f.domain || null` to that object. Ghost nodes (the
`{ id: 'ghost:' + key, ... }` object created when a link target doesn't
resolve) should get `domain: null` explicitly, so they fall back to accent.

## 3. src/lib/brain-scene.js — actually render the color

a) Add a domain → hex color map near the top of the file, next to
   `const ACCENT = 0x00d4ff;`:

```js
const DOMAIN_COLORS = {
  'jarvis-os-core': 0x22e6ff,
  'architecture': 0x3b82f6,
  'ai-models': 0xa855f7,
  'prompt-engineering': 0xf59e0b,
  'automation': 0x2dd4bf,
  'memory-system': 0x34d399,
  'principles': 0xa3e635,
  'knowledge-base': 0x38bdf8,
  'video-engineering': 0xf43f5e,
  'photography': 0xec4899,
};
function colorForDomain(domain) {
  return new Color(DOMAIN_COLORS[domain] ?? ACCENT);
}
```

b) In the Points construction block (where `pGeo` gets `position`, `aSize`,
   `aIntensity`, `aSeed` attributes), add a new per-vertex color attribute:

```js
const colArr = new Float32Array(n * 3);
for (let i = 0; i < n; i++) {
  const c = colorForDomain(simNodes[i].domain);
  colArr[i * 3] = c.r; colArr[i * 3 + 1] = c.g; colArr[i * 3 + 2] = c.b;
}
pGeo.setAttribute('aColor', new BufferAttribute(colArr, 3));
```

c) Update `NODE_VERT` to pass color through as a varying:

```glsl
attribute float aSize;
attribute float aIntensity;
attribute float aSeed;
attribute vec3 aColor;
varying float vIntensity;
varying float vSeed;
varying vec3 vColor;
void main() {
  vIntensity = aIntensity;
  vSeed = aSeed;
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}
```

d) Update `NODE_FRAG` to use `vColor` instead of the `uColor` uniform (leave
   `uColor` uniform declared/wired for now — harmless, just unused by the
   node fragment shader — don't touch the core/nucleus shaders that also
   reference ACCENT elsewhere in the file):

```glsl
uniform float uTime;
uniform float uHaloCore;
uniform float uHaloSoftness;
varying float vIntensity;
varying float vSeed;
varying vec3 vColor;
void main() {
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;
  float coreDisc = 1.0 - smoothstep(uHaloCore * 0.5, uHaloCore, dist);
  float halo = (1.0 - smoothstep(uHaloCore, 0.5, dist)) * uHaloSoftness;
  float alpha = coreDisc + halo;
  float twinkle = 0.85 + 0.15 * sin(uTime * (1.5 + fract(vSeed) * 2.0) + vSeed * 6.28);
  gl_FragColor = vec4(vColor * vIntensity * twinkle, alpha);
}
```

e) In `refreshHighlights()`, where link colors are computed (the loop that
   fills `colAttr` using the single `accent` variable and `degK(si)`/`degK(ti)`
   brightness factors), replace the single `accent` with each endpoint's own
   domain color:

```js
for (let li = 0; li < simLinks.length; li++) {
  const l = simLinks[li];
  const si = idx.get(typeof l.source === 'object' ? l.source.id : l.source);
  const ti = idx.get(typeof l.target === 'object' ? l.target.id : l.target);
  const hot = active >= 0 && (si === active || ti === active);
  const ks = hot ? TUNING.LINK_HOT : degK(si);
  const kt = hot ? TUNING.LINK_HOT : degK(ti);
  const cs = colorForDomain(simNodes[si]?.domain);
  const ct = colorForDomain(simNodes[ti]?.domain);
  colAttr.array[li * 6]     = cs.r * ks;
  colAttr.array[li * 6 + 1] = cs.g * ks;
  colAttr.array[li * 6 + 2] = cs.b * ks;
  colAttr.array[li * 6 + 3] = ct.r * kt;
  colAttr.array[li * 6 + 4] = ct.g * kt;
  colAttr.array[li * 6 + 5] = ct.b * kt;
}
```

   This makes each link fade between its two endpoint domain colors —
   bridge notes crossing domains will visibly blend two hues, which is a
   nice side effect: it makes cross-domain bridges visually obvious.

## Validation after the change

- Re-scan the vault (the "REESCANEAR" button) so the new `domain` field
  gets picked up — don't just hot-reload, the graph data itself needs to
  be rebuilt with the new field.
- Confirm each of the 10 hubs renders in its distinct color from the
  palette above.
- Confirm a bridge note (e.g. "Bridge — Adaptive AI and VBV") renders its
  connecting lines blending between the domain colors of the hubs it
  touches.
- Confirm ghost nodes and any note missing `domain` still render in the
  original cyan — nothing should go invisible or throw.
- Confirm hover/selection highlighting still works (the `hot` brightness
  boost in refreshHighlights should still brighten links, just now on top
  of the domain color instead of the flat accent).

Do not touch the core/nucleus shaders (CORE_VERT/CORE_FRAG) or anything
using ACCENT outside of the node Points material and the link color loop —
the nucleus should stay cyan regardless of domain.
