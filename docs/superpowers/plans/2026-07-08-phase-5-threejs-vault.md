# Fase 5 — Three.js VAULT Upgrade · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevar a cena 3D do VAULT a "qualidade de cinema" (fresnel, halo, gradiente de links, dolly de entrada, hover label estável, perf) sem tocar em streaming/TTS/VAD e preservando as invariantes do CLAUDE.md.

**Architecture:** Evolução incremental in-place de `src/lib/brain-scene.js` (cena three.js imperativa), com um bloco `TUNING` de constantes no topo e detecção de `prefers-reduced-motion`. Toque mínimo em `src/components/VaultBrain.jsx` (o hover label migra pra dentro da cena). A API pública de `createBrainScene` fica estável.

**Tech Stack:** three.js 0.165 (`Points` + `ShaderMaterial`, `LineSegments`, `EffectComposer`/`UnrealBloomPass`/`OutputPass`), d3-force-3d, React 18 (lazy), Vite 5.

## Global Constraints

- **Sem test runner.** O projeto não tem lint/test scripts (CLAUDE.md). A verificação de cada task é: `npm run build` OK (~188 módulos, zero erros) → `npm run dev` com checagem visual/console e **sign-off do operador** → commit. Não introduzir framework de teste.
- **COEP-safe:** zero texturas/assets externos — todo efeito é procedural (matemática em shader). `require-corp` é intocável.
- **`scene.background` (Color gerenciado)** — nunca voltar a `setClearColor` cru (o OutputPass lavaria o preto).
- **`OutputPass` mantido** por último no composer (color space correto através do bloom).
- **`dispose()` simétrico:** todo objeto/material/listener/DOM novo entra no descarte, espelhado. StrictMode double-mount (dev) e context-loss devem sobreviver.
- **Bloom full-res** — não alterar a resolução do `UnrealBloomPass`.
- **Pipeline streaming/TTS/VAD intocado.** Fase 5 é isolada na cena 3D.
- **Branch:** `feat/phase-5-threejs` (já criada). Um commit por task.
- **Constantes visuais** vivem no bloco `TUNING` no topo do arquivo — nenhum número mágico espalhado.
- **Paleta:** `ACCENT = 0x00d4ff` é o único protagonista; nada de novo matiz.

---

## File Structure

- **Modify:** `src/lib/brain-scene.js` — todas as 6 mudanças + bloco `TUNING` + reduced-motion + adições ao `dispose()`.
- **Modify:** `src/components/VaultBrain.jsx` — remover o `<div>` de hover, o estado `hovered`/`setHovered` e o `onHover` passado à cena (Task 6).

Nenhum arquivo novo. Nenhuma dependência nova.

---

## Task 1: Scaffolding — bloco TUNING, reduced-motion, powerPreference

**Files:**
- Modify: `src/lib/brain-scene.js` (topo do arquivo; `WebGLRenderer`; `dispose()`)

**Interfaces:**
- Produces: constante `TUNING` (objeto), variável `prefersReducedMotion` (boolean, lida por Tasks 2–7), `mediaQuery` + handler (limpos no dispose).

- [ ] **Step 1: Adicionar o bloco `TUNING` abaixo das constantes existentes** (`BG`, `ACCENT`, `NUCLEUS_RADIUS`)

```js
// Constantes de ajuste visual/perf da Fase 5 — ajustáveis a quente no dev.
const TUNING = {
  // Fresnel do núcleo (Task 2)
  FRESNEL_POWER: 2.2,      // expoente do rim — maior = borda mais fina
  FRESNEL_BOOST: 1.8,      // intensidade do brilho de borda
  FRESNEL_BASE: 0.35,      // preenchimento interno (evita núcleo "oco")
  RING_EMISSIVE: 1.6,      // multiplicador de brilho do anel mais interno
  RING_FALLOFF: 0.28,      // quanto cada anel externo escurece (0..1)
  // Halo dos nós (Task 3)
  HALO_CORE: 0.26,         // raio do disco brilhante dentro do sprite (0..0.5)
  HALO_SOFTNESS: 0.5,      // força do halo suave até a borda do sprite
  // Gradiente dos links (Task 4)
  LINK_GRADIENT_MIN: 0.06, // brilho no endpoint de menor grau
  LINK_GRADIENT_MAX: 0.30, // brilho no endpoint de maior grau
  LINK_HOT: 0.6,           // brilho de link destacado (hover/seleção)
  // Dolly de entrada (Task 5)
  DOLLY_START: 240,        // distância inicial da câmera
  DOLLY_MS: 1500,          // duração do ease-out
  // Perf (Task 7)
  FRAME_BUDGET_MS: 20,     // acima disso por N frames → baixa o pixelRatio
  PIXEL_RATIO_LOW: 1.5,    // pixelRatio degradado
  IDLE_FPS: 30,            // fps em repouso (throttle)
};
```

- [ ] **Step 2: Detectar reduced-motion logo após obter `width`/`height` em `createBrainScene`**

```js
  const mediaQuery = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  let prefersReducedMotion = !!mediaQuery?.matches;
  const onReducedMotionChange = (e) => {
    prefersReducedMotion = e.matches;
    controls.autoRotate = !e.matches; // reflete em runtime
  };
  // (o addEventListener vai após a criação de `controls`, no Step 3)
```

- [ ] **Step 3: Registrar o listener depois que `controls` existir** (logo após `controls.maxDistance = 320;`)

```js
  mediaQuery?.addEventListener?.('change', onReducedMotionChange);
```

- [ ] **Step 4: Adicionar `powerPreference` ao `WebGLRenderer`**

Trocar:
```js
  const renderer = new WebGLRenderer({ antialias: true });
```
por:
```js
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
```

- [ ] **Step 5: Limpar o listener no `dispose()`** (dentro de `function dispose()`, junto dos outros `removeEventListener`)

```js
    mediaQuery?.removeEventListener?.('change', onReducedMotionChange);
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: `✓ built in …` sem erros; ~188 módulos.

- [ ] **Step 7: Sign-off visual**

Run: `npm run dev` → entrar no VAULT. Expected: cena renderiza igual a antes (nenhuma mudança visual nesta task); console sem erros/warnings novos.

- [ ] **Step 8: Commit**

```bash
git add src/lib/brain-scene.js
git commit -m "feat(vault): phase-5 scaffolding — TUNING block, reduced-motion, powerPreference"
```

---

## Task 2: Fresnel rim no núcleo + anéis emissivos

**Files:**
- Modify: `src/lib/brain-scene.js` (shaders do núcleo; criação de `core`/`rings`; `animate()`)

**Interfaces:**
- Consumes: `TUNING.FRESNEL_*`, `TUNING.RING_*`, `ACCENT`.
- Produces: `core` com `ShaderMaterial` (uniforms `uColor`, `uFresnelPower`, `uFresnelBoost`, `uBase`); `rings` com `MeshBasicMaterial` aditivo de intensidade decrescente.

- [ ] **Step 1: Adicionar os shaders do núcleo** (perto de `NODE_VERT`/`NODE_FRAG`)

```js
const CORE_VERT = `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const CORE_FRAG = `
  uniform vec3 uColor;
  uniform float uFresnelPower;
  uniform float uFresnelBoost;
  uniform float uBase;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float f = pow(1.0 - clamp(dot(vNormal, vView), 0.0, 1.0), uFresnelPower);
    float intensity = uBase + f * uFresnelBoost;
    gl_FragColor = vec4(uColor * intensity, 1.0);
  }
`;
```

- [ ] **Step 2: Trocar o material do `core`**

Trocar:
```js
  const core = new Mesh(new SphereGeometry(4.5, 32, 32), new MeshBasicMaterial({ color: ACCENT }));
```
por:
```js
  const coreMat = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(ACCENT) },
      uFresnelPower: { value: TUNING.FRESNEL_POWER },
      uFresnelBoost: { value: TUNING.FRESNEL_BOOST },
      uBase: { value: TUNING.FRESNEL_BASE },
    },
    vertexShader: CORE_VERT,
    fragmentShader: CORE_FRAG,
  });
  const core = new Mesh(new SphereGeometry(4.5, 32, 32), coreMat);
```

- [ ] **Step 3: Tornar os anéis emissivos (aditivos, gradiente de intensidade)**

Trocar o `.map` dos rings:
```js
  const rings = [8, 11, 14].map((r, i) => {
    const ring = new Mesh(
      new TorusGeometry(r, 0.12, 8, 96),
      new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.5 - i * 0.1 })
    );
    ring.rotation.x = Math.PI / 2 + (i - 1) * 0.4;
    nucleus.add(ring);
    return ring;
  });
```
por:
```js
  const rings = [8, 11, 14].map((r, i) => {
    const k = TUNING.RING_EMISSIVE * (1 - i * TUNING.RING_FALLOFF);
    const ring = new Mesh(
      new TorusGeometry(r, 0.12, 8, 96),
      new MeshBasicMaterial({
        color: new Color(ACCENT).multiplyScalar(k),
        transparent: true,
        opacity: 0.5 - i * 0.1,
        blending: AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.rotation.x = Math.PI / 2 + (i - 1) * 0.4;
    nucleus.add(ring);
    return ring;
  });
```

- [ ] **Step 4: Modular o fresnel com o pulse** (no `animate()`, logo após `core.scale.setScalar(breathe);`)

```js
    core.material.uniforms.uFresnelBoost.value =
      TUNING.FRESNEL_BOOST * (pulse.thinking ? 1.4 : pulse.speaking ? 1.15 : 1.0);
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: sucesso, ~188 módulos.

- [ ] **Step 6: Sign-off visual**

Run: `npm run dev` → VAULT. Expected: núcleo com anel de luz na silhueta (não mais um disco chapado); os 3 anéis brilham com intensidade decrescente pra fora; pulso de `thinking` intensifica a borda. Ajustar `FRESNEL_POWER`/`FRESNEL_BOOST`/`RING_EMISSIVE` se necessário.

- [ ] **Step 7: Commit**

```bash
git add src/lib/brain-scene.js
git commit -m "feat(vault): fresnel rim core + emissive rings"
```

---

## Task 3: Halo suave nos nós

**Files:**
- Modify: `src/lib/brain-scene.js` (`NODE_FRAG`; uniforms do `pMat` em `setGraph`)

**Interfaces:**
- Consumes: `TUNING.HALO_CORE`, `TUNING.HALO_SOFTNESS`.
- Produces: `NODE_FRAG` com uniforms `uHaloCore`, `uHaloSoftness`.

- [ ] **Step 1: Reescrever `NODE_FRAG`** (mantendo o twinkle existente)

```js
const NODE_FRAG = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uHaloCore;
  uniform float uHaloSoftness;
  varying float vIntensity;
  varying float vSeed;
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float coreDisc = 1.0 - smoothstep(uHaloCore * 0.5, uHaloCore, dist);
    float halo = (1.0 - smoothstep(uHaloCore, 0.5, dist)) * uHaloSoftness;
    float alpha = coreDisc + halo;
    float twinkle = 0.85 + 0.15 * sin(uTime * (1.5 + fract(vSeed) * 2.0) + vSeed * 6.28);
    gl_FragColor = vec4(uColor * vIntensity * twinkle, alpha);
  }
`;
```

- [ ] **Step 2: Adicionar os uniforms ao `pMat`** (em `setGraph`, no objeto `uniforms` do `ShaderMaterial`)

Trocar:
```js
      uniforms: { uColor: { value: new Color(ACCENT) }, uTime: { value: 0 } },
```
por:
```js
      uniforms: {
        uColor: { value: new Color(ACCENT) },
        uTime: { value: 0 },
        uHaloCore: { value: TUNING.HALO_CORE },
        uHaloSoftness: { value: TUNING.HALO_SOFTNESS },
      },
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: sucesso, ~188 módulos.

- [ ] **Step 4: Sign-off visual**

Run: `npm run dev` → VAULT (conectar vault de teste pra ter nós). Expected: cada nó tem um disco brilhante central com um halo suave em volta, em vez de um disco de borda dura. Ajustar `HALO_CORE` (menor = mais halo) / `HALO_SOFTNESS`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/brain-scene.js
git commit -m "feat(vault): soft additive halo around nodes"
```

---

## Task 4: Gradiente de brilho nos links

**Files:**
- Modify: `src/lib/brain-scene.js` (`refreshHighlights` — laço de cores dos links)

**Interfaces:**
- Consumes: `TUNING.LINK_GRADIENT_MIN/MAX`, `TUNING.LINK_HOT`, `maxDegree`, `simNodes`.
- Produces: cor por-endpoint em `lines.geometry` proporcional ao grau do nó.

- [ ] **Step 1: Substituir o laço de cores dos links em `refreshHighlights`**

Trocar o bloco:
```js
    const idx = new Map(simNodes.map((n, i) => [n.id, i]));
    const colAttr = lines.geometry.getAttribute('color');
    for (let li = 0; li < simLinks.length; li++) {
      const l = simLinks[li];
      const si = idx.get(typeof l.source === 'object' ? l.source.id : l.source);
      const ti = idx.get(typeof l.target === 'object' ? l.target.id : l.target);
      const hot = active >= 0 && (si === active || ti === active);
      const k = hot ? 0.6 : 0.1;
      colAttr.array[li * 6] = accent.r * k;
      colAttr.array[li * 6 + 1] = accent.g * k;
      colAttr.array[li * 6 + 2] = accent.b * k;
      colAttr.array[li * 6 + 3] = accent.r * k;
      colAttr.array[li * 6 + 4] = accent.g * k;
      colAttr.array[li * 6 + 5] = accent.b * k;
    }
    colAttr.needsUpdate = true;
```
por:
```js
    const idx = new Map(simNodes.map((n, i) => [n.id, i]));
    const colAttr = lines.geometry.getAttribute('color');
    const degK = (i) => {
      const d = simNodes[i]?.degree || 0;
      const t = Math.sqrt(d / Math.max(1, maxDegree)); // sqrt: hubs não estouram
      return TUNING.LINK_GRADIENT_MIN + (TUNING.LINK_GRADIENT_MAX - TUNING.LINK_GRADIENT_MIN) * t;
    };
    for (let li = 0; li < simLinks.length; li++) {
      const l = simLinks[li];
      const si = idx.get(typeof l.source === 'object' ? l.source.id : l.source);
      const ti = idx.get(typeof l.target === 'object' ? l.target.id : l.target);
      const hot = active >= 0 && (si === active || ti === active);
      const ks = hot ? TUNING.LINK_HOT : degK(si);
      const kt = hot ? TUNING.LINK_HOT : degK(ti);
      colAttr.array[li * 6]     = accent.r * ks;
      colAttr.array[li * 6 + 1] = accent.g * ks;
      colAttr.array[li * 6 + 2] = accent.b * ks;
      colAttr.array[li * 6 + 3] = accent.r * kt;
      colAttr.array[li * 6 + 4] = accent.g * kt;
      colAttr.array[li * 6 + 5] = accent.b * kt;
    }
    colAttr.needsUpdate = true;
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: sucesso, ~188 módulos.

- [ ] **Step 3: Sign-off visual**

Run: `npm run dev` → VAULT com vault conectado. Expected: cada aresta é mais brilhante na ponta que toca o nó de maior grau e esmaece em direção ao de menor grau; hubs "puxam" luz. Hover/seleção ainda destaca as arestas conectadas (mais brilhantes). Ajustar `LINK_GRADIENT_MIN/MAX`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/brain-scene.js
git commit -m "feat(vault): link brightness gradient toward higher-degree endpoint"
```

---

## Task 5: Dolly de entrada cinematográfico

**Files:**
- Modify: `src/lib/brain-scene.js` (estado; `create`; `animate()`; handler `controls 'start'`)

**Interfaces:**
- Consumes: `TUNING.DOLLY_START`, `TUNING.DOLLY_MS`, `prefersReducedMotion`, `controls`, `camera`.
- Produces: estado `dollyT`, `dollyStart`, `dollyCancelled`.

- [ ] **Step 1: Adicionar estado do dolly** — declarar **antes** do bloco de init da câmera/dolly (Step 2), logo após `const camera = new PerspectiveCamera(...)`. O Step 2 atribui `dollyT`/`dollyStart` cedo; se as declarações `let` vierem depois (junto do restante do estado mutável), dá `ReferenceError` por temporal dead zone.

```js
  let dollyT = 1;            // 1 = concluído (default: sem dolly)
  let dollyStart = 0;
  let dollyCancelled = false;
```

- [ ] **Step 2: Iniciar o dolly no create** (logo após `camera.position.set(0, 25, 140);`)

```js
  const SETTLE_DIST = 140;
  if (!prefersReducedMotion) {
    camera.position.set(0, 25, TUNING.DOLLY_START);
    dollyT = 0;
    dollyStart = performance.now();
  }
```

- [ ] **Step 3: Cancelar o dolly quando o usuário pega os controles** (no listener existente `controls.addEventListener('start', ...)`)

Trocar:
```js
  controls.addEventListener('start', () => { focusTarget = null; });
```
por:
```js
  controls.addEventListener('start', () => { focusTarget = null; dollyCancelled = true; });
```

- [ ] **Step 4: Aplicar o ease no `animate()`** (antes de `if (pointerDirty) …`, depois do bloco de foco de câmera)

```js
    if (dollyT < 1 && !dollyCancelled && !focusTarget) {
      dollyT = Math.min(1, (performance.now() - dollyStart) / TUNING.DOLLY_MS);
      const e = 1 - Math.pow(1 - dollyT, 3); // ease-out cubic
      const dir = camera.position.clone().sub(controls.target).normalize();
      const r = TUNING.DOLLY_START + (SETTLE_DIST - TUNING.DOLLY_START) * e;
      camera.position.copy(controls.target).add(dir.multiplyScalar(r));
    }
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: sucesso, ~188 módulos.

- [ ] **Step 6: Sign-off visual**

Run: `npm run dev` → entrar no VAULT. Expected: a câmera "mergulha" de longe (~240) até a distância normal (140) em ~1,5s, com ease-out; se você arrastar durante a entrada, o dolly para na hora. Com `prefers-reduced-motion` ligado no SO/DevTools, a cena já começa em 140 (sem dolly). Ajustar `DOLLY_START`/`DOLLY_MS`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/brain-scene.js
git commit -m "feat(vault): cinematic entrance dolly (skipped under reduced-motion)"
```

---

## Task 6: Hover label imperativo estável

**Files:**
- Modify: `src/lib/brain-scene.js` (criar/posicionar/descartar o `<div>`; `doRaycast`; `animate()`; `dispose()`)
- Modify: `src/components/VaultBrain.jsx` (remover `hovered` state, o `<div>` de hover e o `onHover`)

**Interfaces:**
- Consumes: `container`, `screenPos(node)`, `hoveredIndex`, `simNodes`, `C` (cores — inline, sem import: usar literais já usados no VaultBrain).
- Produces: label DOM interno; `onHover` deixa de ser usado pela cena.

- [ ] **Step 1: Criar o elemento de label** (em `createBrainScene`, após `container.appendChild(renderer.domElement);`)

```js
  const hoverLabel = document.createElement('div');
  hoverLabel.style.cssText = [
    'position:absolute', 'pointer-events:none', 'z-index:3', 'display:none',
    'font-size:10px', 'letter-spacing:0.12em', 'color:#c8e8f8',
    'background:rgba(5,10,20,0.85)', 'border:1px solid rgba(0,212,255,0.26)',
    'padding:3px 8px', 'white-space:nowrap', 'transform:translate(12px,-8px)',
  ].join(';');
  container.appendChild(hoverLabel);
```

- [ ] **Step 2: Atualizar texto/visibilidade em `doRaycast`** — substituir as chamadas a `onHover`

Trocar:
```js
      if (idx >= 0) {
        const node = simNodes[idx];
        const sp = screenPos(node);
        onHover?.(node, sp.x, sp.y);
      } else {
        onHover?.(null, 0, 0);
      }
```
por:
```js
      if (idx >= 0) {
        const node = simNodes[idx];
        hoverLabel.textContent = node.ghost ? `▸ ${node.title} · não criada` : `▸ ${node.title}`;
        hoverLabel.style.display = 'block';
      } else {
        hoverLabel.style.display = 'none';
      }
```

- [ ] **Step 3: Reposicionar o label a cada frame no `animate()`** (logo após o bloco `if (pointerDirty) { … doRaycast(); }`)

```js
    if (hoveredIndex >= 0 && hoverLabel.style.display !== 'none') {
      const sp = screenPos(simNodes[hoveredIndex]);
      hoverLabel.style.left = sp.x + 'px';
      hoverLabel.style.top = sp.y + 'px';
    }
```

- [ ] **Step 4: Remover o label no `dispose()`** (junto da remoção do `renderer.domElement`)

```js
    if (hoverLabel.parentNode === container) container.removeChild(hoverLabel);
```

- [ ] **Step 5: Remover o uso de `onHover` na assinatura** — em `createBrainScene(container, { onHover, onSelect } = {})`, trocar por `{ onSelect } = {}` (o parâmetro `onHover` deixa de existir; a cena é dona do label).

- [ ] **Step 6: `VaultBrain.jsx` — remover o `onHover` passado à cena**

No `createBrainScene({ onHover: …, onSelect: … })`, remover a propriedade `onHover` inteira (a arrow que fazia `setHovered(...)`), mantendo `onSelect`.

- [ ] **Step 7: `VaultBrain.jsx` — remover o estado e o JSX do hover**

- Remover a linha `const [hovered, setHovered] = useState(null);`
- Remover o bloco JSX `{hovered && ( <div …>▸ {hovered.title}… </div> )}`.

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: sucesso, ~188 módulos. (Se `useState` ficar sem uso no VaultBrain, conferir que ainda há outros `useState` — há: `selectedNote`, `noteContent`, `resetKey`, `contextLost` — então o import permanece.)

- [ ] **Step 9: Sign-off visual**

Run: `npm run dev` → VAULT com vault conectado. Expected: passar o mouse sobre um nó mostra o rótulo; **durante o autoRotate o rótulo acompanha o nó** (não desgruda mais); sair do nó esconde o rótulo. Ghost nodes mostram "· não criada".

- [ ] **Step 10: Commit**

```bash
git add src/lib/brain-scene.js src/components/VaultBrain.jsx
git commit -m "feat(vault): imperative hover label that tracks node during autoRotate (fixes H8)"
```

---

## Task 7: Performance — pixelRatio adaptativo, throttle 30fps, reduced-motion

**Files:**
- Modify: `src/lib/brain-scene.js` (estado de perf; `animate()`)

**Interfaces:**
- Consumes: `TUNING.FRAME_BUDGET_MS`, `TUNING.PIXEL_RATIO_LOW`, `TUNING.IDLE_FPS`, `prefersReducedMotion`, `renderer`, `composer`, `controls`, `pulse`, `settled`, `hoveredIndex`, `downPos`, `focusTarget`.

- [ ] **Step 1: Adicionar estado de perf** (junto dos outros `let` de estado)

```js
  let lastFrameStamp = performance.now();
  let slowFrames = 0, fastFrames = 0, lowRatio = false;
  let lastRenderStamp = 0;
```

- [ ] **Step 2: Aplicar reduced-motion no autoRotate no create** (logo após configurar `controls.autoRotate = true;`)

```js
  if (prefersReducedMotion) controls.autoRotate = false;
```

- [ ] **Step 3: Congelar o movimento de núcleo/twinkle sob reduced-motion** — no `animate()`, envolver os blocos de breathe/rings/ripple e o avanço de `uTime`

Trocar:
```js
    // Núcleo: respiração / pulso de pensamento / ondulação de fala
    const breathe = pulse.thinking ? 1 + 0.10 * Math.sin(t * 9) : 1 + 0.04 * Math.sin(t * 1.2);
```
por (adicionar guarda no topo do bloco de movimento do núcleo):
```js
    // Núcleo: respiração / pulso / ondulação — congelado sob reduced-motion
    const mt = prefersReducedMotion ? 0 : t;
    const breathe = prefersReducedMotion ? 1
      : (pulse.thinking ? 1 + 0.10 * Math.sin(t * 9) : 1 + 0.04 * Math.sin(t * 1.2));
```
E trocar as referências de `t` dentro do bloco do núcleo (coreInner scale, rings rotation, ripple) por `mt`, e o `points.material.uniforms.uTime.value = t;` por `= mt;`. (Assim, sob reduced-motion, twinkle/rotação/ripple ficam estáticos num estado aceso.)

- [ ] **Step 4: Adaptar o `pixelRatio` e aplicar o throttle** — no topo de `animate()`, logo após `const t = (performance.now() - t0) / 1000;`

```js
    const now = performance.now();
    const frameMs = now - lastFrameStamp;
    lastFrameStamp = now;

    // pixelRatio adaptativo com histerese
    if (!lowRatio && frameMs > TUNING.FRAME_BUDGET_MS) {
      if (++slowFrames > 30) {
        lowRatio = true; slowFrames = 0;
        renderer.setPixelRatio(TUNING.PIXEL_RATIO_LOW);
        composer.setPixelRatio(renderer.getPixelRatio()); // não setSize: só setPixelRatio re-dimensiona os render targets do bloom
      }
    } else if (lowRatio && frameMs < TUNING.FRAME_BUDGET_MS * 0.6) {
      if (++fastFrames > 120) {
        lowRatio = false; fastFrames = 0;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        composer.setPixelRatio(renderer.getPixelRatio()); // não setSize: só setPixelRatio re-dimensiona os render targets do bloom
      }
    } else { slowFrames = 0; fastFrames = 0; }

    // Throttle 30fps em repouso (settled, sem interação/foco/fala/pensamento)
    const idle = settled && hoveredIndex < 0 && !downPos && !focusTarget
      && !pulse.thinking && !pulse.speaking;
    if (idle && now - lastRenderStamp < 1000 / TUNING.IDLE_FPS) return;
    lastRenderStamp = now;
```

Nota: o `return` sai antes de `controls.update()`/`composer.render()`, mas o `requestAnimationFrame(animate)` já foi agendado no topo da função — o loop continua, só pula o trabalho deste frame.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: sucesso, ~188 módulos.

- [ ] **Step 6: Sign-off visual + perf**

Run: `npm run dev` → VAULT. Expected:
- Em repouso (cena assentada, sem mouse), o uso de GPU cai (throttle 30fps) — autoRotate continua fluido.
- Ao interagir/hover/falar, volta a 60fps.
- Com `prefers-reduced-motion` (DevTools → Rendering → Emulate CSS prefers-reduced-motion), o núcleo fica estático aceso, sem autoRotate, sem twinkle; interação e assentamento inicial funcionam.
- Sob carga (ex: vault grande), o pixelRatio cai pra 1.5 sem oscilar.

- [ ] **Step 7: Commit**

```bash
git add src/lib/brain-scene.js
git commit -m "feat(vault): adaptive pixelRatio, 30fps idle throttle, reduced-motion freeze"
```

---

## Task 8: Verificação de integração (dispose, context-loss, architecture-guardian)

**Files:** nenhuma edição de código (task de verificação e possíveis correções pontuais).

- [ ] **Step 1: Build final**

Run: `npm run build`
Expected: sucesso, ~188 módulos, zero warnings novos.

- [ ] **Step 2: Teste de vazamento de contexto WebGL**

Run: `npm run dev`. Alternar TERMINAL↔VAULT ~10 vezes. Expected: sem crescimento de contextos WebGL perdidos no console; sem "Too many active WebGL contexts". (O `dispose()` estendido — coreMat, rings, hoverLabel, mediaQuery listener — deve zerar tudo.)

- [ ] **Step 3: Teste de context-loss + StrictMode**

Em dev (StrictMode monta 2×): confirmar que a cena inicializa sem erro. Simular context-loss (DevTools ou `WEBGL_lose_context`) → overlay "NÚCLEO GRÁFICO INTERROMPIDO" + REINICIAR reconstrói a cena limpa.

- [ ] **Step 4: Rodar o architecture-guardian no diff**

Invocar o agente `architecture-guardian` sobre o diff de `feat/phase-5-threejs` vs `main`. Foco: simetria de `dispose()`, COEP (zero assets externos), `scene.background` intocado, OutputPass mantido. Corrigir o que ele apontar (inline, novo commit se necessário).

- [ ] **Step 5: Sign-off visual final do operador**

Passada completa no `npm run dev`: fresnel, halo, gradiente de links, dolly, hover label, throttle, reduced-motion. Ajustar constantes `TUNING` até aprovação. Commit de tuning final se houver ajustes:

```bash
git add src/lib/brain-scene.js
git commit -m "chore(vault): final TUNING pass for phase-5"
```

- [ ] **Step 6: Abrir PR**

```bash
git push -u origin feat/phase-5-threejs
gh pr create --base main --head feat/phase-5-threejs --title "feat(vault): Phase 5 — three.js cinematic upgrade" --body "..."
```

---

## Self-Review

**Spec coverage:** fresnel core+rings → T2; halo → T3; link gradient → T4; dolly → T5; hover label → T6; perf (powerPreference/pixelRatio/throttle) → T1+T7; reduced-motion abrangente → T1 (detecção) + T5 (dolly) + T7 (autoRotate/twinkle); dispose/COEP/context-loss → T8; TUNING block → T1. Todos os itens do spec têm task.

**Placeholders:** nenhum "TBD/TODO"; cada step de código mostra o código real; comandos exatos com output esperado.

**Type/nome consistency:** `TUNING.*` definido em T1 e consumido com os mesmos nomes; `coreMat`/`hoverLabel`/`dollyT`/`prefersReducedMotion`/`mediaQuery`/`onReducedMotionChange` consistentes entre tasks; `screenPos`/`refreshHighlights`/`animate`/`dispose` são funções já existentes referenciadas pelos nomes reais.

**Ambiguidade:** o "test cycle" é explicitamente build + visual (sem runner) — declarado nas Global Constraints, coerente em todas as tasks.
