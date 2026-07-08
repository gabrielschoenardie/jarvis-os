# JARVIS OS — Hollywood HUD Upgrade · Roadmap

> Status: **Fases 1, 2 e 3 CONCLUÍDAS** · próximas: Fase 4 → 6.
> Origem: auditoria completa do repositório (07/07/2026).
> Regra: uma fase por vez, commits pequenos, verificar `npm run dev` + `npm run build` antes de avançar.
> Invariantes CLAUDE.md sempre valem: nunca tocar `require-corp`, pipeline de streaming/TTS intocado na lógica, `dispose()` simétrico no three.js.

---

## Fase 1 — Foundation & Quick Wins ✅ CONCLUÍDA

**Objetivo**: sistema de tokens, primitivas HUD compartilhadas, correções de instrumentos, fontes self-hosted, piso de acessibilidade.

> Entregue: tokens em `constants.js` (z/motion/space/radius/glass/type/MODEL/clampPct); `src/components/hud/` (Corners/HoloPanel/HudButton/HudLabel) com dedup das cantoneiras nos 3 arquivos; fontes self-hosted em `public/fonts/` (latin+latin-ext, preload no boot, sem `<link>` runtime); Meter com `max`/clamp; label do modelo single-source; boot com cleanup+skip; auto-scroll grudento; `:focus-visible` + `prefers-reduced-motion`. Build OK (186 módulos), VaultBrain segue lazy-split. Sem mudança de lógica em streaming/voz/VAD.

- Estender `src/lib/constants.js`: tokens de spacing / type scale / z-index / motion (durações 150/300/450ms + easings).
- Criar `src/components/hud/`: `Corners`, `HoloPanel`, `HudButton`, `HudLabel` (hoje os corner brackets estão duplicados 3× em `HudMediaWindow`, `WeatherCard`, `VaultBrain`; ~15 variantes inline de botão).
- Self-host Rajdhani + JetBrains Mono (woff2 em `public/fonts/` + `@font-face` no `index.html`) — mata o FOUT do boot e remove origem third-party sob COEP. Remover o inject de `<link>` em `App.jsx:85-91`.
- `Meter.jsx`: tokens ≠ porcentagem (TOKENS SESSÃO vive cravado em 12/12); clampar CONTEXTO IA em 100%.
- Nome do modelo single-source (hoje hard-coded em 3 lugares: header "Núcleo 4.6", `BootSequence`, rail esquerdo "sonnet-4.6").
- Boot: cleanup dos `setTimeout` + skip por tecla.
- Auto-scroll só quando o usuário está perto do fundo (`App.jsx:99-101`).
- `:focus-visible` styles (input hoje tem `outline: none` sem substituto) + bloco `prefers-reduced-motion`.

## Fase 2 — React Performance Hardening ✅ CONCLUÍDA

**Objetivo**: 60fps estável durante streaming. **Só topologia de render — zero mudança de lógica em `useChat`/`anthropic.js`.**

> Entregue: `useTelemetry` agora empurra a latência ao vivo por assinatura (`subscribeLatency`/`getLatency`) — o tick de 100ms não passa mais por estado React; `<LatencyReadout>` (folha em App.jsx) re-renderiza só a si mesma. Removido `setTelemetry` (era passado ao useChat e nunca usado). `TerminalView`: linhas do histórico em `useMemo([history, onOpenHud])` + `AIText` com `React.memo` → durante o stream o histórico não é recriado nem re-parseado. `useChat`: `setStreamText` agrupado por `requestAnimationFrame` (≤1 update/frame, com `cancelStream` protegendo os sets diretos/erros); `openHudMedia`/`closeHudMedia` em `useCallback` (referências estáveis pro memo). Lógica de TTS/tool/streaming intocada. Build OK (186 módulos), dev boot OK.

- Problema central (C1): tick de 100ms do `useTelemetry` + `setStreamText` por chunk re-renderizam a árvore inteira; `AIText` re-parseia o markdown completo a cada chunk; nenhum `React.memo` no projeto.
- `React.memo` nas linhas de histórico; memoizar `AIText` por mensagem; linha de streaming vira componente próprio.
- Contador de latência isolado em componente folha (subscribe via ref/callback, não state no App).
- rAF-batch do `setStreamText` (coalescer chunks SSE por frame).
- Verificar TTS sentence-feeding e tool-status após cada commit.

## Fase 3 — Motion Design & Presence Core (elemento assinatura) ✅ CONCLUÍDA

**Objetivo**: uma gramática de movimento; JARVIS vira presença física.

> Entregue: `src/components/PresenceCore.jsx` — arc-reactor SVG (~116px) cujo estado (`idle/listening/thinking/speaking/tool`) deriva de `thinking/speaking/listening/toolStatus`; motion = estado (halo, rotação dos anéis, respiração/pulso do núcleo, ondas de fala, marcador orbital de ferramenta) + legenda de estado. Keyframes `pc-*` no bloco `<style>` do App. Montado como **hero flutuante** ancorado acima do command input (só no modo terminal; no VAULT o núcleo 3D é a outra projeção — handoff no fade de troca). Banners (FOCO/TRANSMITINDO) viraram **overlay absoluto** com slide-in (`jv-banner-in`) → acabou o layout jump (H1). Troca terminal↔VAULT com fade (`jv-mode-in`, `key={mode}`). Sob `prefers-reduced-motion` o core repousa estático aceso. Build OK (187 módulos). **Nota**: "saídas do boot" ficou mínima de propósito — o log de boot persiste como cabeçalho da conversa; o orçamento de motion foi pro core/banners/transição.

- **`src/components/PresenceCore.jsx`**: arc-reactor 2D (SVG/CSS, sem three.js no terminal) ancorado no command input. Vocabulário de estados:
  - idle → respiração lenta 4s
  - listening → abertura aponta pro usuário + anel brilha
  - thinking → contra-rotação rápida assimétrica
  - speaking → ripples radiais sincronizados com início de sentenças TTS
  - tool → segmento orbital rotulado (reusa `toolStatus`)
  - Mesmo vocabulário do núcleo do VAULT — um ser, duas projeções.
- Banners (TRANSMITINDO / MODO FOCO) viram overlay/height-animated — eliminar o layout jump (`App.jsx:349`).
- Crossfade 400ms na troca terminal↔VAULT com "handoff" do core entre projeções.
- Linhas do boot ganham exit; curvas de easing compartilhadas via tokens.

## Fase 4 — Visual Polish & Layout

**Objetivo**: hierarquia tipográfica, sistema de profundidade, responsividade.

- Type scale: labels ≥10px; `C.dim` elevado a ~3:1 onde carrega significado; Rajdhani reservada a momentos display; numerais tabulares em números vivos; tracking 0.32em só em eyebrows.
- Profundidade em 3 camadas: void (efeitos de fundo) → estrutura (rails, hairlines, sem blur) → projeção (glass + blur + corner brackets — brackets viram marca exclusiva de superfícies projetadas).
- Background void em 2 stops (`#030710 → #071018` radial).
- Command input vira o momento "cockpit"; `VoicePanel` agrupado em clusters rotulados; `HudMediaWindow` arrastável + vinheta de backdrop.
- Breakpoints: rails colapsam em icon strip <1280px, drawers overlay <900px (hoje grid fixo `220px 1fr 240px` — quebrado em mobile).
- Rails com sinais reais (status do vault, pipeline de voz, modelo real, contexto real) no lugar de ficção estática.
- `AIText`: código visível durante stream (hoje invisível até fechar o fence), links, `###`, formatação inline em list items.
- ErrorBoundary em volta do `VaultBrain` lazy.

## Fase 5 — Three.js Upgrade

**Objetivo**: VAULT em qualidade de cinema dentro do pipeline existente. **Só `src/lib/brain-scene.js`.**

- Fresnel rim shader no core do núcleo (substituir `MeshBasicMaterial` chapado) + gradiente emissivo nos anéis.
- Node shader: segundo termo de falloff = halo suave em volta do disco (zero texturas, COEP-safe).
- Gradiente de brilho nos links em direção ao endpoint de maior grau.
- Entrada cinematográfica: dolly de câmera 1.5s (r≈240→140) no create — pulado sob reduced-motion.
- Hover label acompanha o nó por frame durante autoRotate (hoje deriva).
- Perf: `pixelRatio` adaptativo (→1.5 se frame >20ms), bloom meia-resolução opcional, `powerPreference: 'high-performance'`, throttle 30fps quando settled + sem interação + sem speaking/thinking.
- `dispose()` simétrico para cada objeto novo; testar context-loss e StrictMode double-mount; rodar `architecture-guardian` no diff.

## Fase 6 — Final Refinement

- Matriz de estados completa: idle/listening/thinking/streaming/tool/speaking × terminal/VAULT × voz on/off.
- Passe reduced-motion + keyboard-only; build + preview com CPU/GPU throttled.
- Fallbacks Firefox/Safari (iframe credentialless, VAD não suportado).
- Atualizar CLAUDE.md com o novo mapa de componentes e tokens.

---

## Direção visual (resumo)

**"Um instrumento de precisão que por acaso é bonito."** Identidade ciano-sobre-void mantida e afiada:

- Luz é informação: nada brilha em repouso; brilho é gasto em mudanças de estado.
- Paleta: `#00d4ff` único protagonista; âmbar só atenção; vermelho só falha; nenhum terceiro matiz.
- Rajdhani = voz da máquina (display); JetBrains Mono = dados.
- Elemento assinatura: **Presence Core** — um organismo arc-reactor projetado nos dois modos, cujo movimento É a máquina de estados do assistente.

## Riscos principais

1. Regressão no pipeline streaming/TTS (Fase 2) → só topologia de render, verificar a cada commit.
2. Retune de tokens achatar a estética (Fases 1/4) → mudanças incrementais + screenshot-compare.
3. three.js: assimetria de dispose / context-loss (Fase 5) → registrar tudo no `dispose()`, `architecture-guardian`.
4. COEP: fontes self-hosted reduzem exposição; `require-corp` intocável.

## Auditoria de referência (achados classificados)

- **CRITICAL**: C1 re-render storm no streaming · C2 sem presence unificada · C3 sem responsividade · C4 Meter/contexto quebrados.
- **HIGH**: H1 layout jump dos banners · H2 troca de modo sem transição · H3 sem motion tokens/reduced-motion · H4 sem primitivas HUD · H5 contraste/9px/outline · H6 FOUT das fontes · H7 auto-scroll forçado · H8 three.js (label drift, bloom full-res, pixelRatio 2) · H9 rails com dados estáticos.
- **MEDIUM**: M1 AIText limitado · M2 boot não skipável · M3 sem ErrorBoundary no lazy · M4 HudMediaWindow não arrastável · M5 VoicePanel denso · M6 núcleo sem fresnel · M7 z-index mágicos.
- **LOW**: L1 pushOutOfNucleus no-op branch · L2 key={i} no histórico · L3 reduce de tokens por render · L4 helpers duplicados · L5 powerPreference ausente.
