# Fase 5 — Three.js Upgrade (VAULT) · Design

> Data: 2026-07-08 · Escopo: cena 3D do VAULT (`src/lib/brain-scene.js`), com toque
> mínimo em `src/components/VaultBrain.jsx`. Origem: `docs/HUD_UPGRADE_ROADMAP.md`
> Fase 5. Brainstorming via `superpowers:brainstorming`.

## Objetivo

Elevar a cena do VAULT a "qualidade de cinema" **dentro do pipeline existente**, sem
tocar em streaming/TTS/VAD e preservando as invariantes do CLAUDE.md. Seis mudanças:
fresnel no núcleo, halo nos nós, gradiente nos links, dolly de entrada, hover label
estável, e um conjunto de otimizações de performance.

## Decisões (do brainstorming)

1. **Reduced-motion abrangente.** Sob `prefers-reduced-motion: reduce`: pular o dolly,
   desligar `autoRotate`, congelar twinkle/ripple/breathe num estado estático aceso.
   Manter a física de assentamento inicial (transitória, necessária ao layout) e toda
   a interação (arrastar/hover/focar). O passe keyboard-only + matriz de estados
   completa continua sendo Fase 6.
2. **Bloom full-res.** Performance segurada por `pixelRatio` adaptativo + throttle
   30fps, sem tocar na assinatura visual do bloom. Meia-res descartada (YAGNI +
   custo estético).
3. **Hover label imperativo dentro da `brain-scene.js`** — sem re-render React no
   caminho quente.
4. **Constantes de tuning no topo do arquivo** + sign-off visual do operador no
   `npm run dev`. Um PR, commits pequenos por item.

## Arquitetura & interface

- **Um arquivo de lógica**: `src/lib/brain-scene.js`. A API pública de
  `createBrainScene(container, { onHover?, onSelect })` mantém
  `setGraph / setPulse / focusNode / clearFocus / getPositions / onContextLost /
  dispose` **estáveis**.
- **Bloco `TUNING`** nomeado no topo do arquivo com todas as constantes visuais/perf.
- **Toque mínimo em `VaultBrain.jsx`**: o rótulo de hover passa a ser dono da cena;
  remover o `<div>` de hover, o estado `hovered`/`setHovered` e o `onHover` que só o
  alimentava (~8 linhas). Nenhuma outra mudança no componente. `onSelect` (painel de
  nota) permanece.
- **Detecção de reduced-motion**: `matchMedia('(prefers-reduced-motion: reduce)')`
  lido no `create`, com listener de mudança em runtime e cleanup no `dispose()`.

## As 6 mudanças

### 1. Fresnel rim no núcleo + anéis emissivos (M6)
- Substituir o `MeshBasicMaterial` do `core` por um `ShaderMaterial` fresnel: brilho de
  borda por `dot(normal, viewDir)` — luz na silhueta em vez de disco liso.
- `coreInner` (esfera branca) permanece.
- Os 3 anéis de torus ganham gradiente emissivo (mais quente perto do núcleo, esmaece
  pra fora) via shader simples ou cor por vértice.
- **Integra com o pulse existente**: respiração/pulso continua sendo `scale` no
  `animate()`; uniforms fresnel (`uFresnelPower`, `uFresnelBoost`) modulam com
  `thinking`/`speaking`.
- Tuning: `FRESNEL_POWER`, `FRESNEL_BOOST`, `RING_EMISSIVE`.

### 2. Halo suave nos nós (shader)
- Estender `NODE_FRAG`: além do disco atual (`smoothstep(0.25, 0.5)`), somar um
  **segundo termo de falloff** mais amplo e suave — halo aditivo ao redor do disco,
  escalado por intensidade/grau. Zero texturas (COEP-safe).
- Tuning: `HALO_SIZE`, `HALO_SOFTNESS`.

### 3. Gradiente de brilho nos links
- Links já usam `vertexColors`. Hoje ambos os vértices recebem a mesma cor.
- Passar a colorir os dois endpoints com brilhos diferentes — mais brilhante no nó de
  **maior grau**, esmaecendo em direção ao de menor grau. Calculado em
  `setGraph`/`refreshHighlights` (que já iteram os links). Reforça hubs.
- Tuning: `LINK_GRADIENT_MIN`, `LINK_GRADIENT_MAX`.

### 4. Dolly de entrada cinematográfico
- No `create`, câmera começa afastada (`r ≈ DOLLY_START`, ~240) e faz ease até a
  distância atual (140) em `DOLLY_MS` (~1500ms), curva ease-out.
- **Pulado sob reduced-motion** (começa já em 140).
- Cancelado se o usuário pegar os controles no meio (reusa o handler `controls 'start'`
  que já zera `focusTarget`).
- Tuning: `DOLLY_START`, `DOLLY_MS`.

### 5. Hover label imperativo estável (H8)
- A cena cria um `<div>` absoluto no `container`, estilizado inline (aparência atual:
  fundo escuro, borda ciano, título + "· não criada" para ghost).
- Enquanto há nó sob o cursor, reposicionar via `screenPos(node)` **a cada frame** no
  `animate()` — acompanha o nó durante o autoRotate (fim do drift). Escondido sem hover.
- `VaultBrain` perde o div/estado antigos.

### 6. Performance (sem custo estético)
- `powerPreference: 'high-performance'` no `WebGLRenderer` (L5).
- **`pixelRatio` adaptativo**: medir tempo de frame; se sustentadamente >20ms, cair de
  `min(dpr, 2)` para `1.5`; voltar quando aliviar. Histerese para não oscilar.
- **Throttle 30fps**: quando `settled && sem hover && sem drag && sem focusTarget &&
  sem thinking/speaking`, `animate()` pula frames para ~30fps. Volta a 60 na primeira
  interação/fala.
- **Reduced-motion**: pula dolly, `autoRotate=false`, congela twinkle (`uTime` fixo) /
  ripple / breathe num estado estático aceso; mantém física de assentamento +
  interação.
- Tuning: `PIXEL_RATIO_LOW` (1.5), `FRAME_BUDGET_MS` (20), `IDLE_FPS` (30).

## Invariantes & `dispose()`

- **Simetria de `dispose()`**: cada objeto novo entra no descarte, espelhado — os
  `ShaderMaterial` novos (core + anéis) liberados; o `<div>` do rótulo removido do
  `container` explicitamente; o listener do `matchMedia` removido. Nenhum novo
  `addEventListener` órfão.
- **Context-loss & StrictMode**: throttle e `pixelRatio` adaptativo vivem *dentro* do
  `animate()` (que já respeita `disposed`/`contextLost`), sem novos caminhos de rAF.
  O rebuild via `resetKey` continua; StrictMode double-mount coberto pelo `dispose()`
  simétrico.
- **CLAUDE.md**: COEP-safe (tudo procedural, zero assets externos); `scene.background`
  (Color gerenciado) intocado — nunca `setClearColor` cru; `OutputPass` mantido após o
  bloom; streaming/TTS/VAD não tocados.

## Verificação

1. `npm run build` OK.
2. `npm run dev` sobe sem erro/warn no console; entrar no VAULT, conectar vault de teste.
3. **`architecture-guardian`** rodado no diff (dispose / COEP / context-loss).
4. Entrar/sair do VAULT várias vezes sem vazar contexto WebGL.
5. Sign-off visual do operador no `npm run dev`, iterando as constantes `TUNING`.

## Entrega

Um PR (`feat/phase-5-threejs`), commits pequenos por item (fresnel → halo → links →
dolly → hover → perf), `npm run build` verificado a cada commit.

## Fora de escopo (Fase 6)

Matriz de estados completa; passe keyboard-only; fallbacks Firefox/Safari; atualização
do CLAUDE.md com o novo mapa de componentes/tokens.
