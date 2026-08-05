# JARVIS OS — Plano de execução · Auditoria do HUD (modo terminal)

> **Origem**: auditoria de design "Stark Industries · Controle de Qualidade Visual", 29/07/2026.
> **Árvore auditada**: `d5e3cd0c` — corresponde exatamente ao `main` atual (inclui #55, #56 e #57).
> **Escopo da auditoria**: modo terminal a 1440px. Identidade ciano-sobre-void mantida.
> **Resultado**: 11 achados · 3 P0 · 6 P1 · 2 superfícies novas.
> **Regra herdada do roadmap**: uma etapa por vez, commits pequenos, `npm run build` verde antes de avançar.

---

## Como este plano se encaixa no roadmap

Esta auditoria **não abre uma frente nova** — ela é, quase item a item, a "passada guiada"
que a Fase 4b explicitamente adiou. O `HUD_UPGRADE_ROADMAP.md` registra:

> **4b — deixado pro olho do usuário (H5)**: retune agressivo de contraste/tipografia
> (elevar `C.dim` global a ~3:1, Rajdhani só display, revisão de tracking) — subjetivo e
> não verificável headless; command input "cockpit" e VoicePanel em clusters completos
> também ficaram pra uma passada guiada.

Três metas declaradas da Fase 4 continuam abertas e são exatamente o que a auditoria
aponta:

| Meta declarada na Fase 4 | Achado correspondente | Status real |
|---|---|---|
| "labels ≥10px; `C.dim` elevado onde carrega significado" | P0·1 | não feito |
| "Profundidade em 3 camadas: estrutura **sem blur**; projeção = glass + blur + cantoneiras" | P1 · PROFUNDIDADE | **invertido** hoje |
| "Rails com sinais reais no lugar de ficção estática" | P0·2 + Cinta de estado | feito só pro VAULT |

Ou seja: as etapas 1–4 abaixo **fecham a Fase 4b**; as etapas 5–6 são a Fase 4c nova.
A Fase 5 (three.js) segue intocada — está fora do escopo desta auditoria.

---

## Decisões travadas antes de começar

**1. Interpretação da rampa de cor.** A auditoria desenha 5 tokens de texto mas não cita o
`muted` atual. Decisão: `muted` é **clareado**, `quiet` é **novo**, `dim` é **despromovido**.

| token | hoje | vira | contraste s/ `#050a14` | papel |
|---|---|---|---|---|
| `text` | `#c8e8f8` | — | 15,43:1 | conteúdo primário |
| `accent` | `#00d4ff` | — | 11,19:1 | vivo / mudou de estado |
| `muted` | `#4a7a99` | **`#7fa8bf`** | 4,28 → **7,79:1** | rótulo de seção legível |
| `quiet` | — | **`#517a92`** *(novo)* | **4,29:1** | texto silencioso (piso AA) |
| `accentDim` | `#007a99` | **`#0090b3`** | 4,00 → **5,32:1** | borda/ação secundária |
| `dim` | `#1e3a4a` | *(inalterado)* | 1,66:1 | **só hairline e ponto inativo — nunca texto** |

**2. Correções à auditoria** (verificadas por cálculo WCAG 2.1 sobre `#050a14`):

- `muted+ #7fa8bf` mede **7,79:1**, não 7,4:1 — o documento subestima. Não muda a decisão.
- O achado dos medidores diz "ou puxar o usage real da API". **Já é real**: `sessionTokens`
  acumula `input + output` do evento `jarvis_tokens` (`api/chat.js:303` → `useChat.js:318`).
  A desonestidade está **só no denominador** (`max={100000}` em `App.jsx`, um teto inventado)
  e na barra de 12 segmentos nítidos. O trabalho é de escala e notação, não de dados.
- O achado dos 4 banners inclui o `🧠 MEMÓRIA` introduzido no PR #57. A crítica procede:
  ele é um **estado persistente exibido como notificação permanente**. A Etapa 4 o remove
  como banner e o move para a cinta.

**3. Regra de profundidade** (vale nas etapas 3 e 4, resolve P1 · PROFUNDIDADE):
`blur` é privilégio de superfície projetada. Estrutura (header, cinta, barra de comando,
rails) usa **fundo opaco + hairline, sem blur**. Só recebe `blur` o que também tem
cantoneira (`hud/Corners.jsx`). Hoje está invertido: estrutura a `blur(8px)`, `.jv-holo-glass`
a `blur(6px)`.

---

## Regras que valem em todas as etapas

- **Nada de novo matiz, nova fonte ou nova lógica** de streaming, TTS ou VAD.
- `npm run build` verde ao fim de cada etapa; contagem de módulos anotada no commit.
- `prefers-reduced-motion` continua respeitado em tudo que se mexer.
- Um PR por etapa, na ordem — as etapas 3 e 4 dependem da 1.
- Invariantes do `CLAUDE.md` seguem valendo (nunca tocar `require-corp`, `dispose()`
  simétrico no three.js).

### Como tornar isto verificável headless

O roadmap adiou este trabalho por ser "não verificável headless". Isso se resolve com um
script de lint de design rodado a cada etapa (`scripts/design-lint.mjs`, criado na Etapa 1):

1. **Zero `C.dim` como texto** — falha se `color: C.dim` aparecer fora de borda/fundo.
2. **Piso tipográfico** — falha em qualquer `fontSize` < 10 fora da allowlist (SVG de gráfico).
3. **Rampa de contraste** — recalcula WCAG de cada token sobre `C.bg` e falha abaixo do piso
   declarado na tabela acima.
4. **Orçamento de pulso** — falha se `jv-pulse` aparecer em elemento sem fonte de estado.
5. **Regra de blur** — falha se `blur(` aparecer em bloco sem cantoneira.

O que continua exigindo olho humano (e por isso vira checklist manual no PR): ritmo,
alinhamento da gutter de 88px e a sensação do "momento cockpit".

---

## Etapa 1 — Rampa de contraste e piso tipográfico

**Fecha**: P0·1 · **Risco**: BAIXO · **Depende de**: nada · **Abre caminho para**: 3, 4

Etapa de maior alcance e menor risco: é troca de token, sem mudança estrutural. Feita
primeiro porque as etapas 3 e 4 desenham superfícies novas e precisam já nascer na rampa
certa.

**O que muda**
- `src/lib/constants.js`: `muted` → `#7fa8bf`; novo `quiet: '#517a92'`; `accentDim` → `#0090b3`;
  comentário travando `dim` como não-texto.
- `type.micro` hoje é `fontSize: 9` — sobe para `10`. É o vetor do "piso de 10px" citado na
  auditoria, já que `type.*` é o vocabulário único de tipografia.
- Substituir `C.dim` → `C.quiet` nas ocorrências **de texto**. São ~20 dos 33 usos totais;
  os outros ~13 (bordas, pontos inativos, `disabled`) ficam como estão.
- Varrer os **54 usos de `fontSize` 8/9/9.5** em 10 arquivos contra o piso.

**Arquivos**: `src/lib/constants.js` (fonte da mudança) · `App.jsx`, `Meter.jsx`,
`TerminalView.jsx`, `VoicePanel.jsx`, `PresenceCore.jsx`, `VaultBrain.jsx`,
`VoiceIndicator.jsx`, `hud/HudButton.jsx`, `HudMediaWindow.jsx` (aplicação).

**Decisão pendente dentro da etapa**: `WeatherCard.jsx` usa `fontSize="8"` em rótulos de eixo
SVG. Gráfico denso é caso legítimo de exceção ao piso — proposta é **isentar SVG de dados**
e registrar na allowlist do lint, em vez de inflar os eixos.

**Critério de pronto**
- `design-lint` passa nas regras 1, 2 e 3.
- Nenhum texto abaixo de 4,5:1; nenhum elemento de interface abaixo de 3:1.
- Build verde. Diff é só cor e tamanho — zero mudança de layout.

---

## Etapa 2 — Sinal vs. cenário, e instrumentos honestos

**Fecha**: P0·2, P1 · MEDIDORES, P1 · HIERARQUIA · **Risco**: BAIXO · **Depende de**: 1

Hoje há **15 pontos pulsando em repouso** e apenas um é medido. A gramática do pulso perdeu
o significado. Esta etapa devolve o pulso a quem tem estado real.

**O que muda**
- **Subsistemas** (`App.jsx:415-427`): só `VAULT` — o único ligado a `vault.status` — mantém
  ciano + `jv-pulse`. Os outros 9 viram cenário: tick fino estático, sem cor, sem animação.
- **Sentinelas** (`App.jsx:605-615`): hoje têm `className="jv-pulse"` **incondicional**, sem
  nenhuma fonte de dado. Perdem o pulso e a cor; viram lista estática.
- **Wordmark** (`App.jsx:355`): `STARK INDUSTRIES` em Rajdhani 700/22px `C.accent` é o
  elemento mais brilhante da tela em repouso. Vai para `C.text` peso 500 — o ciano volta a
  ser de quem muda de estado, e o Presence Core reassume o papel de assinatura.
- **Medidores** (`Meter.jsx` + `App.jsx:598-601`): `CONTEXTO IA` e `TOKENS SESSÃO` passam a
  marcar estimativa com `≈` e trocam a barra de 12 segmentos nítidos por um traço contínuo.
  O teto inventado de 100k sai da barra (o número real permanece).

**Arquivos**: `src/App.jsx` (rails, header) · `src/components/Meter.jsx`

**Critério de pronto**
- Pontos pulsando em repouso caem de **15 para 1** (VAULT quando conectado).
- `design-lint` regra 4 passa.
- Nenhuma barra segmentada representa número estimado.

---

## Etapa 3 — O command input vira cockpit

**Fecha**: P0·3, P1 · REDUNDÂNCIA (parcial) · **Risco**: MÉDIO · **Depende de**: 1

É o único lugar onde o operador age, e hoje é o menos desenhado. Risco médio porque mexe na
interação primária — exige verificação manual no navegador, não só build.

**O que muda**
- Remover o **cursor falso**: `<span className="jv-blink">▌</span>` solto depois do ENVIAR
  (`App.jsx:~570`) duplica o caret real do input.
- **Unificar os três botões** via `hud/HudButton.jsx` (já existe): hoje MIC é círculo de 34px
  (`VoiceIndicator.jsx:33`), ANEXO e ENVIAR são retângulos com bordas diferentes. Passam a
  MIC/ANEXO fantasma + **ENVIAR sólido — a única coisa preenchida da tela**.
- **Gutter de 88px**: o texto digitado passa a alinhar com a coluna da conversa, herdando o
  `minWidth: 88` do rótulo `SIR · GABRIEL` (`TerminalView.jsx:143`).
- **Cantoneiras** (`hud/Corners.jsx`) marcam o input como superfície projetada — e, pela regra
  de profundidade, é aqui que o `blur` passa a ser legítimo. A barra de comando em si perde
  o `blur(8px)` (`App.jsx:509`) e fica opaca com hairline.
- **Comandos viram teclas** legíveis, saindo do rodapé de 9,5px `C.dim` (`App.jsx:587`). O
  `◉ VOZ ATIVA` sai daqui (redundante com o Presence Core).

**Arquivos**: `src/App.jsx` · `src/components/hud/HudButton.jsx` ·
`src/components/VoiceIndicator.jsx` · `src/components/hud/Corners.jsx`

**Critério de pronto**
- Um só caret na tela; um só elemento sólido.
- Prompt alinhado à coluna de 88px da conversa.
- Manual: enviar por clique, por `↵`, por voz e com anexo — todos sem regressão.

---

## Etapa 4 — Cinta de estado, e banners reduzidos a eventos

**Fecha**: P1 · BANNERS, P1 · MOBILE, P1 · REDUNDÂNCIA, P1 · PROFUNDIDADE · **Risco**: MÉDIO · **Depende de**: 1

A superfície de maior retorno do plano: resolve quatro achados de uma vez e é o único
instrumento que sobrevive abaixo de 900px.

**O problema hoje**: quatro banners (`focusMode`, `speaking`, `captureSaved`, `memória`)
compartilham o mesmo overlay e podem empilhar quatro fileiras sobre a conversa. Dois deles
são **estados persistentes**, não eventos. E abaixo de 900px `.jv-rail-left` some
(`App.jsx:330`) levando junto vault, contexto, latência e modelo.

**O que muda**
- Novo `src/components/StatusStrip.jsx`: faixa de **28px** sob o header, só com sinal real e
  persistente — vault (+ contagem de notas), memória em contexto, pipeline de voz, modelo,
  contexto, latência.
- **Regra de leitura**: um item só ganha ciano quando está ativo ou mudou nos últimos
  segundos; em repouso a cinta inteira é `quiet`.
- Banners viram **eventos transitórios, um por vez, com fila**. `memória` e `foco` saem da
  fila e viram itens da cinta. Sobra como banner o que é ação disponível (ex.: silenciar).
- A cinta **sobrevive a <900px** — é a resposta ao achado de mobile.
- Header, cinta e banners perdem `blur(8px)` e ficam opacos com hairline (regra de
  profundidade). `.jv-holo-glass` segue como única superfície com blur.

**Arquivos**: novo `src/components/StatusStrip.jsx` · `src/App.jsx` (banners, header, media
queries) · `src/hooks/useChat.js` (o flash `captureSaved` deixa de ser banner permanente)

**Critério de pronto**
- Nunca mais de **um** banner na tela ao mesmo tempo.
- A 375px de largura: vault, contexto, latência e modelo continuam visíveis.
- `design-lint` regra 5 passa.

---

## Etapa 5 — Void reativo (`--jv-ambient`)

**Fecha**: MOVIMENTO (achado 11) · **Risco**: BAIXO · **Depende de**: nada (paralelizável)

Hoje grade, grão, scanline e dez colunas de dados rodam **na mesma intensidade** em espera,
ouvindo ou transmitindo. Movimento constante é textura; movimento que muda é informação.

**O que muda**
- Uma única variável no root, `--jv-ambient`, derivada do **mesmo estado que já alimenta o
  Presence Core**. Grade, streams e vinheta leem a variável. **Nenhum elemento novo, nenhum
  `setInterval` novo.**

  | estado | valor | leitura |
  |---|---|---|
  | em espera | 0.30 | grade e vinheta apenas |
  | ouvindo | 0.55 | grade acende, streams lentos |
  | processando | 0.85 | streams densos e rápidos |
  | transmitindo | 0.70 | pulso radial por sentença |
  | falha | 0.20 | void esfria, âmbar assume |

- **Scanline removida** (`App.jsx:277` + `:345`): é o único efeito que não carrega informação
  nenhuma e é o que mais compete com o texto durante a leitura.
- Sob `prefers-reduced-motion`, a variável congela no valor de repouso.

**Arquivos**: `src/App.jsx` (bloco `<style>` + efeitos)

**Critério de pronto**
- Os quatro estados são visualmente distintos sem nenhum texto na tela.
- Nenhum novo timer no profiler; `reduced-motion` congela em 0.30.

---

## Etapa 6 — Inspetor de memória (só leitura)

**Fecha**: superfície nova nº2 · **Risco**: MÉDIO · **Depende de**: 4 (abre pela cinta)

A auditoria chama esta de "a que mais vale a pena", e o argumento é forte: **toda mensagem
enviada carrega um resumo das ~5 notas mais recentes do vault, por recência pura, sem busca
semântica** — e a única UI disso hoje é um contador. É a decisão de produto mais consequente
do app (entregue no PR #57) exposta como um emoji.

O caso real citado: `lista-compras.md` entra no contexto de uma conversa técnica só por ser
recente. Um clique resolve — mas só se houver onde clicar.

**O que muda**
- Novo `src/components/MemoryPanel.jsx`: painel projetado (glass + cantoneiras), aberto pela
  cinta, listando **quais notas estão no prompt agora** e o custo estimado em tokens de cada.
- `src/lib/memoryContext.js` precisa expor o detalhamento por nota. Hoje `buildMemoryContext`
  retorna **uma string achatada**; passa a retornar também a lista de entradas com estimativa
  de tokens, sem mudar o formato do texto que vai pro prompt.

**Incremento seguinte (não nesta etapa)**: fixar/excluir nota. Isso deixa de ser visual —
altera o que entra em `memoryContext` e, portanto, o comportamento do assistente. A versão
só-leitura entrega ~80% do valor sem esse risco, e por isso vem primeiro.

**Arquivos**: novo `src/components/MemoryPanel.jsx` · `src/lib/memoryContext.js` ·
`src/hooks/useVault.js` (expor o detalhamento) · `src/components/StatusStrip.jsx` (gatilho)

**Critério de pronto**
- A lista do painel bate exatamente com o que foi enviado no último request.
- O total de tokens do painel bate com o teto de ~2000 caracteres já aplicado.
- Nenhuma mudança no texto efetivamente enviado ao modelo nesta etapa.

---

## Fora de escopo

- **Fase 5 (three.js do VAULT)** — `brain-scene.js` intocado; a auditoria declara escopo
  "modo terminal".
- **Novo matiz, nova fonte, novo layout de grid.**
- **Lógica de streaming, TTS ou VAD.**
- **Busca semântica / embeddings** para a memória — a decisão de recência pura permanece;
  esta auditoria só a torna *visível*.
- **Fixar/excluir nota** no inspetor de memória (incremento posterior à Etapa 6).

---

## Rastreabilidade — achado → etapa

| # | Achado | Prio | Etapa |
|---|---|---|---|
| 1 | Nove dos dez subsistemas são ficção e pulsam como sinal real | P0·2 | 2 |
| 2 | Rótulos em `C.dim` a 9–10px · 1,66:1 | P0·1 | 1 |
| 3 | Estado de voz em três/quatro lugares ao mesmo tempo | P1 | 3 + 4 |
| 4 | Barra de tokens com escala arbitrária (teto inventado de 100k) | P1 | 2 |
| 5 | Quatro banners empilhados; um deles permanente | P1 | 4 |
| 6 | Latência em 26px é o maior número da tela | P1 | 2 |
| 7 | Sentinelas: quatro pontos pulsando, nenhum medido | P0·2 | 2 |
| 8 | Rails não sobrevivem a <900px | P1 | 4 |
| 9 | Cursor falso ao lado de ENVIAR | P0·3 | 3 |
| 10 | Comandos como hints de 9,5px em `C.dim` | P0·3 | 1 + 3 |
| 11 | Grade, grão, scanline e streams na mesma intensidade sempre | MOV | 5 |
| — | Blur em estrutura mais forte que em projeção | P1 | 3 + 4 |
| — | Wordmark rouba o palco do núcleo | P1 | 2 |
| — | Cinta de estado (superfície nova) | — | 4 |
| — | Inspetor de memória (superfície nova) | — | 6 |

---

## Ordem recomendada

```
Etapa 1  ─┬─→  Etapa 2
          ├─→  Etapa 3  ─┐
          └─→  Etapa 4  ─┴─→  Etapa 6
Etapa 5  ────  (paralelizável a qualquer momento)
```

**Se for para fazer só uma**: Etapa 1 — é a que muda a leitura da tela inteira pelo menor
risco. **Se for para fazer só duas**: 1 e 4 — juntas resolvem 7 dos 11 achados.
