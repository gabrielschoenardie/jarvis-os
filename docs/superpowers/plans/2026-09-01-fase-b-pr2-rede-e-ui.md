# Fase B · PR 2 — rede e UI (handoff do Orchestrator)

> **Bloco de handoff.** Escrito pelo Orchestrator para ser executado por
> `ai_ml_worker` numa sessão limpa. Não é uma spec independente: a spec
> canônica é `docs/HYBRID_MEMORY_PLAN.md`, seções **B0.1, B1, B6, B7, B8, B9,
> B11, B12, B14, B15, B16, B17, B18**. Este documento marca o escopo do PR 2,
> a ordem obrigatória das etapas, e o que não pode ser mal lido.

**Repo:** `jarvis-os` (o vault é repo irmão e não se toca aqui)
**Base:** `main` **depois do PR 1 mergeado** · **Branch a criar:** `feat/fase-b-pr2-rede-e-ui`
**Executor:** `ai_ml_worker`
**Handoff anterior:** `docs/superpowers/plans/2026-08-31-fase-b-pr1-nucleo-puro.md`

> 🚦 **Pré-condição dura.** Este PR não começa antes do PR 1 estar **mergeado
> na `main`**. Ele consome quatro módulos que só existem lá. Se
> `src/lib/indexCrypto.js` não estiver na `main`, pare e reporte ao
> Orchestrator em vez de reimplementar qualquer parte do núcleo.

---

## O que o PR 1 entregou e este PR consome

Sem reimplementar nada, sem duplicar nada:

| Módulo | O que este PR chama |
| --- | --- |
| `src/lib/indexCrypto.js` | `encryptIndex(plainBytes, passphrase, {salt, iterations})` · `decryptIndex(objectBytes, passphrase)` · `newSalt()` |
| `src/lib/indexSerialize.js` | `serializeIndex(index, {deviceId})` · `deserializeIndex(bytes, {indexVersion, modelId, dims})` |
| `src/lib/syncCapability.js` | `newSyncSecret()` · `objectIdFrom(syncSecret)` · `encodeSyncCode` / `decodeSyncCode` |
| `src/lib/deviceId.js` | `getDeviceId(storage)` |

Se alguma assinatura tiver saído diferente no PR 1 mergeado, **a assinatura
real vence este documento** — ajuste as chamadas e diga no PR que ajustou.

## Ler antes de escrever qualquer linha

1. `docs/HYBRID_MEMORY_PLAN.md` — as seções listadas no cabeçalho. **É a fonte da verdade.**
2. `CLAUDE.md` § *Vault Semantic Memory (Fase A)* — o invariante de privacidade, que ganha uma saída de rede nova e nenhuma exceção.
3. `src/hooks/useVaultIndex.js` (não se toca) e `src/lib/idb.js` — é por essas funções que o sync lê e escreve o índice.
4. `src/components/MemoryPanel.jsx` e `src/components/StatusStrip.jsx` — as duas superfícies que ganham estado.

---

## Ordem das etapas — não é sugestão

A ordem existe porque cada etapa fecha uma incerteza da seguinte. Etapas 0 a 2
são infraestrutura e prova; sem elas o cliente seria escrito sobre uma
suposição, e falha de CORS/preflight aparece no navegador como erro de rede
opaco, sem status e sem corpo.

### Etapa 0 — infraestrutura, feita pelo **operador**, fora do repo (B7, B12, B13)

Nada disto é trabalho de agente: envolve credenciais e o dashboard da
Cloudflare. O worker **não pede, não recebe e não lê** `CLOUDFLARE_R2_KEY` ou
`CLOUDFLARE_R2_SECRET` em momento nenhum deste PR.

Checklist para o operador executar antes da Etapa 2:

- [ ] Bucket R2 **privado** `jarvis-memory-index` criado.
- [ ] **Versionamento desligado** (B13 — ligado, cada `PUT` retém ~8 MB e o custo deixa de ser zero).
- [ ] Token S3 criado, restrito a esse bucket. Guardar Access Key ID e Secret.
- [ ] As 4 vars de servidor (B12) na Vercel, em Production **e** Preview.
- [ ] `VITE_MEMORY_SYNC_ENABLED` na Vercel — **só depois** que o cliente existir; enquanto ausente, a feature é inerte por contrato (B11) e é assim que se quer que a `main` fique até o fim do PR.
- [ ] Política de CORS do bucket aplicada (o JSON de B7, ao pé da letra).

**A origem de produção é entrada do operador, não do worker.** O repo não a
registra em lugar nenhum — o `README.md` só tem o placeholder
`https://jarvis-os-USUARIO.vercel.app`. O worker **não deve adivinhar** nem
inventar um domínio para escrever no JSON de CORS: ele deixa o campo marcado
como `<origem-de-produção>` e o operador preenche no dashboard.

**O problema das URLs de Preview, e a única saída limpa.** A validação visual
deste projeto acontece em deploy da Vercel, não em `npm run dev` — e cada
deploy de preview ganha um hostname próprio com hash
(`jarvis-os-<hash>-<escopo>.vercel.app`), que nunca vai estar na
`AllowedOrigins` de um bucket. Sem tratar isso, **todo teste no preview falha no
preflight** e o sintoma é indistinguível de assinatura errada. Saída: usar o
**alias estável de branch** que a Vercel emite
(`jarvis-os-git-<branch>-<escopo>.vercel.app`) e incluí-lo em `AllowedOrigins`
como entrada **temporária**, ao lado de `http://localhost:5173`. Ambos saem da
política antes de a fase ser considerada pronta — item do checklist de deploy,
não configuração permanente.

`AllowedOrigins` **nunca** vira `*`. O ciphertext protege o conteúdo; não
protege integridade nem disponibilidade (B10).

### Etapa 1 — B0.1: remover o legado, em commit próprio

`api/memory-sync.js` (252 linhas, commitado direto na `main` em `0344d97`) sai
**inteiro**, num commit sozinho, antes de qualquer código novo. Nada dele é
base, nem parcialmente: declara `runtime: 'edge'` e usa `Buffer`, tem
`hmacSHA256()` devolvendo a string literal `'xxxxxxxx'`, e faz proxy do blob —
o desenho que B1 descarta. Nada em `src/` o importa; apagar não quebra nada.

Commit próprio para que o diff mostre que o código morto **saiu**, em vez de
ter sido remendado.

### Etapa 2 — spike do PUT condicional (B6) · **parada obrigatória no fim**

B6 constrói todo o controle de concorrência sobre uma suposição que ninguém
verificou: que o R2 honra `If-Match` / `If-None-Match` num `PUT` autorizado por
**URL pré-assinada** (query-signed), e que o navegador consegue **ler o `ETag`**
da resposta. A documentação da Cloudflare confirma que o R2 suporta os headers
condicionais e confirma que presigned URLs podem carregar headers assinados,
mas **não documenta a combinação**. Por isso o spike vem antes do cliente.

O spike tem duas metades, e a segunda não é opcional: a primeira prova o R2, a
segunda prova o **navegador** — que é onde a transferência real acontece, sob
CORS de bucket e sob os headers COOP/COEP que este app aplica a `/(.*)`.

**Metade A — Node, sem navegador.** Script `scripts/spike-r2-conditional.mjs`,
commitado, **não** ligado ao `npm test` (exige credenciais vivas). Lê tudo de
`process.env`; **quem o executa é o operador**
(`! node scripts/spike-r2-conditional.mjs`), com as credenciais no ambiente
dele. Assina com `aws4fetch` (`signQuery: true`), contra
`idx/<objectId de teste>` — 32 bytes aleatórios passados por `objectIdFrom`,
mesmo caminho do código real. Sete medições, cada uma registrando **o status
cru**:

1. `PUT` com `If-None-Match: *` num objeto inexistente → esperado `200`/`201`.
2. O mesmo `PUT` repetido → esperado `412` (é o que faz "primeira escrita" significar alguma coisa).
3. `HEAD` → capturar o `ETag` exatamente como veio, **aspas incluídas**.
4. `PUT` com `If-Match: <etag capturado>` → esperado `200`.
5. `PUT` com `If-Match: "<etag inventado>"` → esperado `412`.
6. `PUT` com os três `x-amz-meta-*` assinados → `HEAD` devolve os três de volta.
7. `PUT` **omitindo** um header que está em `X-Amz-SignedHeaders` → esperado
   `403 SignatureDoesNotMatch`. Isso decide se uma URL assinada com pré-condição
   pode ser reusada sem ela (a resposta esperada é *não*, e isso fixa o contrato
   do signer: cada pré-condição exige uma assinatura própria).

Ao final o script apaga o objeto de teste com um `DELETE` assinado — em Node,
onde a CORS do bucket não se aplica; o bucket continua sem expor `DELETE` ao
navegador, por decisão de B7.

**Metade B — navegador, no deploy de preview.** Não precisa do signer (ele
ainda não existe): o operador gera **uma** URL na Metade A e a usa no console
do app já publicado, na origem que está na `AllowedOrigins`. Quatro medições:

1. O preflight `OPTIONS` do `PUT` (com `if-match`, `content-type` e os três `x-amz-meta-*`) passa.
2. `response.headers.get('etag')` devolve string, **não `null`** — se vier
   `null`, `ExposeHeaders` está errado e o mecanismo de B6 morre em silêncio.
3. O `HEAD` devolve os `x-amz-meta-*` legíveis pelo JS.
4. Nenhum erro de COEP no console. Esta é a razão de a metade B existir:
   `vercel.json` aplica `Cross-Origin-Embedder-Policy: require-corp` a `/(.*)`,
   então a página é cross-origin-isolated e o `fetch` para o R2 acontece dentro
   dela. A expectativa é que passe — CORP protege carregamento `no-cors`, e um
   `fetch` em modo `cors` que passa no CORS é aceito —, mas *expectativa* é
   exatamente o que este spike existe para substituir. E se falhar não há
   remendo barato: uma presigned URL de `GET` aceita override de
   `response-content-type` e afins, mas **não** permite injetar
   `Cross-Origin-Resource-Policy`.

**Resultado.** Escrever `docs/superpowers/spikes/2026-09-XX-r2-conditional-put.md`
com as 11 medições e seus status crus, e commitá-lo. A conclusão muda o desenho
do cliente de forma permanente; ela pertence ao repo, não ao corpo do PR.

> ⛔ **PARADA OBRIGATÓRIA.** Terminado o spike, **reportar ao Orchestrator** e
> aguardar. Dois desfechos:
> - **A — o R2 honra a condicional.** Segue para a Etapa 3 como especificado.
> - **B — não honra**, ou o `ETag` não chega ao JS. **Não improvisar** o
>   fallback de `HEAD`-antes-do-`PUT` que B6 menciona: ele troca uma garantia
>   por uma janela de corrida assumida, e essa é decisão de projeto do operador,
>   não do executor.

**Nenhuma URL pré-assinada gerada no spike pode ser commitada, colada no PR,
numa issue ou num log.** Ela *é* a credencial (B8).

### Etapa 3 — o signer novo (B9)

`api/memory-sync.js`, Edge, `aws4fetch` (dependência deliberada — foi a
proibição de dependências que produziu o SigV4 falso do arquivo legado).

```text
GET /api/memory-sync?op=<head|get|put>&objectId=<64 hex>[&ifMatch=<etag>|&ifNoneMatch=*]
   → 200  { url, method, expiresAt, headers: { … } }   ~1 KB
   → 400  objectId ou op inválidos
   → 405  qualquer método que não seja GET (OPTIONS de preflight à parte)
   → 501  R2 não configurado no ambiente
```

Regras, todas verificáveis no diff:

- `objectId` validado contra `^[0-9a-f]{64}$` e `op` contra a allowlist **antes**
  de assinar. Sem isso é um assinador genérico de caminhos arbitrários no bucket.
- Chave montada como `idx/<objectId>`, prefixo fixo. Nenhuma outra entrada do
  cliente chega a uma posição de caminho.
- TTL de **5 minutos** (`X-Amz-Expires=300`), escopada a um objeto e a um método.
- `Cache-Control: no-store` na resposta — nenhuma camada intermediária guarda
  uma capability.
- Sem corpo de requisição, sem proxy, nenhum byte de índice passa por aqui.
- **Edge de verdade**: nada de `Buffer`, `node:crypto`, `fs`. Foi o primeiro
  defeito do arquivo que a Etapa 1 apagou.
- Credenciais R2 só em `process.env`, jamais numa resposta.
- **Não logar o `objectId` inteiro** — ele é a bearer capability no fio. Log de
  erro registra verbo, status e no máximo um prefixo curto.
- CORS do signer: `Access-Control-Allow-Origin` com a **origem exata**, nunca
  `*`. Derivar de `new URL(request.url).origin` — o app e o signer estão no
  mesmo deploy, então isso acerta produção e preview sem env var nova. Não
  introduzir uma quinta variável de ambiente; B12 lista quatro e é a lista.

**O que o signer devolve em `headers` é contrato, não conveniência.** Com
`signQuery: true`, o `aws4fetch` põe os *nomes* dos headers assinados em
`X-Amz-SignedHeaders` — os **valores** não vão na URL. O navegador tem que
repetir cada um byte a byte, ou o R2 responde `403 SignatureDoesNotMatch`
(medição 7 do spike). Então o signer devolve o conjunto exato, e o cliente o
repassa sem editar.

### Etapa 4 — `src/lib/indexSync.js` (B6, B8, B15)

`peek()` (`HEAD`) · `pull()` · `push()`, cada um pedindo a URL ao signer,
usando, e descartando. Puro o bastante para ser testado com `fetch` falso.

- O `ETag` da última leitura/escrita bem-sucedida é o **único** estado de
  concorrência que importa. `updatedAt` e `deviceId` continuam existindo como
  metadados de UI e diagnóstico e **não decidem nada**.
- Primeira escrita: `If-None-Match: *`. Seguintes: `If-Match: <etag conhecido>`.
- `412` → conflito. **Nunca** retentado automaticamente. Retry só para erro de
  rede/5xx, com backoff, limitado, e **sempre com a mesma pré-condição** —
  retry jamais relaxa a pré-condição.
- `403` (URL expirada) é estado normal: pede outra URL e refaz a operação
  **uma** vez, sem laço.
- `404` no `HEAD`/`GET` é o primeiro dispositivo, não erro.
- `501` do signer é **`disabled`**, não falha: R2 não configurado no ambiente é
  o mesmo caminho da flag desligada.

### Etapa 5 — `src/hooks/useIndexSync.js` (B11)

Coordena `peek()` no mount, `push()` com debounce **longo (≥ 5 min)** após scan
bem-sucedido, a ação manual do painel e o estado de conflito.

- Sem `VITE_MEMORY_SYNC_ENABLED`: retorna `{ status: 'disabled' }` e **não
  registra efeito algum**. Ausência de flag não é "tentar e falhar"; é não
  existir.
- Mount faz `peek()` e **oferece**. Nunca baixa sozinho. Nenhum download
  automático, nunca.
- `useVaultIndex.js` e `memoryContext.js` não mudam **nem uma linha**.
  `searchMemory` nunca aguarda rede.

### Etapa 6 — wiring de UI (B14)

`useVault.js` passa a expor o estado de sync no seu `return` (hoje termina em
`layoutCacheRef`), `App.jsx` repassa, `MemoryPanel` e `StatusStrip` renderizam.

**MemoryPanel** (hoje é só leitura, recebe `detail`): campo de passphrase
`type="password"`, sem `autocomplete`, **sem persistência de nenhum tipo** —
some ao fechar a aba, por design; ação `SINCRONIZAR` explícita; aviso
`⚠ ÍNDICE REMOTO DIFERENTE — CARREGAR?` quando o `peek()` vê `ETag` diferente;
em conflito, `CARREGAR DO CLOUD` **ou** `MANTER LOCAL`, nunca automático; texto
de última sincronização e qual dispositivo escreveu; código de sync atrás de uma
ação explícita de revelar, nunca visível por padrão; erro de decifragem avisa e
oferece retry e **não destrói nem marca nada local**.

**StatusStrip**: item `CLOUD` **só enquanto sincroniza**, some ao terminar —
mesma regra que o item `ÍNDICE` já segue. Nunca um `CLOUD` permanente em
repouso; era a proposta da v2 e reintroduziria o que o PR #67 removeu.

`npm run lint:design` vale para o código novo: nada de z-index mágico (usar `z`
de `constants.js`), piso tipográfico de 10px, `C.dim` nunca é texto, disciplina
de blur, orçamento de pulso.

### Etapa 7 — testes (B17)

`indexSync.test.js` com `fetch` falso, cobrindo exatamente: flag desligada →
**zero `fetch`** e `status: 'disabled'`; `403` → pede outra URL e refaz **uma**
vez, sem laço; `404` no `GET` → normal; `HEAD` lê `ETag` e os `x-amz-meta-*`;
`PUT` bem-sucedido atualiza o `ETag` conhecido; `If-Match` válido → `200`;
`If-None-Match: *` na primeira escrita e conflito se já existir; **`412` →
conflito e o remoto NÃO é sobrescrito**; retry de rede com a mesma pré-condição
e `412` nunca retentado.

Mais o teste-guarda de constantes descrito no item 2 dos erros previsíveis.

**Privacidade, como asserção e não como intenção:** nenhum caminho de código
envia o blob para `/api/memory-sync` (a chamada é `GET`, sem corpo); nenhuma
presigned URL é persistida ou logada; a passphrase não aparece em
`localStorage`, `sessionStorage` nem IndexedDB depois de um ciclo completo; e o
grep no `dist/` depois do build não acha `CLOUDFLARE_R2_KEY` nem
`CLOUDFLARE_R2_SECRET` nem os valores de teste.

### Etapa 8 — aceitação

Dois navegadores, mesma passphrase, código de sync transportado à mão, o índice
atravessa; depois, escrita concorrente nos dois para provocar `412` e ver o
fluxo de conflito. Feita pelo operador, no deploy — não em `npm run dev`.

**Decisão do Orchestrator sobre o passo 8 de B18 (Playwright):** este PR **não
adiciona Playwright**. O repo não tem runner de browser, o CI só roda
`npm run build`, e trazer um framework de e2e mais os browsers no mesmo PR que
introduz a primeira saída de rede da Fase B junta duas mudanças grandes numa
revisão só. A aceitação manual com dois navegadores acima é o gate deste PR; a
suíte Playwright contra o **build de produção** fica registrada como PR próprio,
e o worker **não deve instalá-la por iniciativa própria** — nova devDependency e
mudança de CI não são chamada do executor.

---

## Oito coisas que um implementador erra sozinho

1. **O índice em memória não vê o `pull()`.** `useVaultIndex.js` lê o IndexedDB
   **uma única vez**, no mount (`useEffect(…, [])`, linha 47), e daí em diante
   trabalha sobre `indexRef.current`. Um `pull()` que escreve o índice remoto no
   IDB não é visto pela busca — e, pior, o próximo scan faz o diff contra o
   índice **antigo em memória** e sobrescreve no IDB o que acabou de ser
   baixado. Como B11 proíbe tocar no hook, a única saída correta é
   `CARREGAR DO CLOUD` **recarregar a página** depois de gravar o IDB, com o
   operador avisado. Expor um "recarregar índice" pelo hook seria mudá-lo, e ele
   não muda.
2. **Quatro constantes precisam ser reescritas à mão — e um teste tem que
   impedir a divergência.** `INDEX_KEY = 'jarvis-vault-index'`,
   `INDEX_VERSION = 2`, `MODEL_ID = 'multilingual-e5-small'`, `DIMS = 384` vivem
   em `useVaultIndex.js:16-19` e **não são exportados**; exportá-los é mudar o
   arquivo, o que B11 proíbe. Então `indexSync.js` as declara de novo — e isso é
   exatamente a segunda fonte da verdade que B0.0 proibiu para o serializer. O
   que resolve sem tocar no hook: um teste que **lê `useVaultIndex.js` como
   texto**, extrai os quatro valores por regex e afirma que batem com os de
   `indexSync.js`. É barato, roda em `node --test` sem arrastar React, e falha
   ruidosamente no próximo bump de `INDEX_VERSION` — que é o único momento em
   que isso importa.
3. **`syncSecret` e `ETag` não podem morar dentro do registro do índice.** O
   hook faz `idbSet(INDEX_KEY, next)` a cada reindexação, substituindo o
   **registro inteiro**: qualquer campo extra some na primeira nota editada.
   Estado de sync vai numa chave própria do mesmo store `kv`
   (ex.: `jarvis-sync-state` = `{ syncSecret, etag, lastRemote }`).
4. **`content-type` é *unsignable* no `aws4fetch`; `if-match` e `x-amz-meta-*`
   não são.** O `UNSIGNABLE_HEADERS` da lib inclui `content-type`,
   `content-length`, `range` e outros — eles não entram na assinatura a menos
   que se passe `allHeaders: true`. Os `x-amz-*` e o condicional **entram**, e
   aí o navegador precisa repeti-los idênticos. O `ETag` do R2 vem **com
   aspas**: guardar e reenviar byte a byte, sem "limpar".
5. **Preview da Vercel não é origem estável.** Hostname com hash a cada deploy
   nunca vai casar com `AllowedOrigins`, e a falha aparece como erro de rede sem
   status. Usar o alias estável de branch, temporário, e removê-lo no fim.
6. **COEP `require-corp` está em `/(.*)`** (`vercel.json`), e é load-bearing
   para o VAD — não se mexe nele por causa do sync. A transferência para o R2
   acontece dentro de uma página cross-origin-isolated; é por isso que a metade
   B do spike existe e por isso ela roda no app publicado, não numa página de
   teste solta que não teria esses headers.
7. **Uma presigned URL é a credencial.** Vive numa variável, é usada, é
   descartada: não vai para `localStorage`, IndexedDB, estado persistido, cache
   de resposta, `console.log`, telemetria ou relatório de erro. Ao registrar
   falha de sync, registrar **verbo e status**, jamais a URL.
8. **`501` não é erro.** R2 não configurado no ambiente cai no mesmo caminho da
   flag desligada: `disabled`, silencioso, Fase A intacta. Tratar como falha
   produziria um erro visível em toda instalação que não usa sync.

---

## Invariantes que este PR não pode violar

- **Não tocar:** `src/hooks/useVaultIndex.js` · `src/lib/memoryContext.js` ·
  `src/lib/vectorIndex.js` · `src/lib/chunker.js` · `src/lib/embedder.js` ·
  `src/workers/embedder.worker.js` · `src/lib/jarvis-prompts.js` ·
  `src/lib/anthropic.js` · `api/chat.js` · `vite.config.js`.
- **Retrieval é local e independente de rede.** `searchMemory` nunca aguarda
  rede, nunca consulta o R2, nunca falha por causa de sync. Busca local funciona
  offline, com ou sem flag.
- O invariante de privacidade da Fase A segue inteiro. A Fase B acrescenta
  **uma** saída de rede nova, e ela carrega **apenas ciphertext**: nenhum corpo
  de nota, nenhum excerpt, nenhum embedding em claro sai por aqui.
- Modelo `Xenova/multilingual-e5-small`, `q8`, **384 dims** — nunca redefinido.
- Passphrase **nunca** persistida, em lugar nenhum.
- Credenciais R2 jamais em `src/`, jamais com prefixo `VITE_`, jamais numa
  resposta do signer.
- COOP/COEP e os assets do VAD em `vite.config.js` intocados.

## Fora do escopo deste PR

Delta sync por chunk · quantização `int8` dos vetores · rotação/revogação de
capability · terceiro dispositivo · prova de posse do `syncSecret` no signer
(HMAC sobre a requisição) · rate limiting no signer · `DELETE` de objeto remoto
pelo navegador · suíte Playwright · qualquer mudança de retrieval, de
`memoryContext` ou de `api/chat.js`.

---

## Gates antes do PR

`npm test` · `npm run build` · `npm run lint:design` — os três verdes. O CI
(`.github/workflows/webpack.yml`) roda **só** `npm run build`, nas versões 18,
20 e 22 do Node: os outros dois são responsabilidade de quem abre o PR, e o
`aws4fetch` mais o signer precisam passar em **Node 18**.

Mais um gate deste PR: depois do `npm run build`,
`grep -rE "CLOUDFLARE_R2_(KEY|SECRET)" dist/` não retorna nada.

## Checklist de deploy (operador, depois do merge)

- [ ] `VITE_MEMORY_SYNC_ENABLED` definida na Vercel (sem ela a feature fica inerte).
- [ ] Versionamento do bucket confirmado **desligado**.
- [ ] `http://localhost:5173` e o alias de preview **removidos** da `AllowedOrigins`.
- [ ] Aceitação com dois navegadores feita, incluindo o `412`.

## Entrega

Branch → PR contra `main`. **Não commitar direto na `main`** — foi assim que o
`api/memory-sync.js` quebrado escapou de revisão. Commits em ordem:

1. `chore: remove o api/memory-sync.js legado (B0.1)` — sozinho.
2. `chore: aws4fetch + spike do PUT condicional no R2 (B6)` — script + resultado. **← parada obrigatória**
3. `feat: signer Edge de memory-sync com presigned URLs (B9)`
4. `feat: indexSync + useIndexSync atrás da flag, com ETag condicional (B6, B11)`
5. `feat: estado de sync no MemoryPanel e no StatusStrip (B14)`
6. `docs: VITE_MEMORY_SYNC_ENABLED e a nota de privacidade do índice cifrado`
   — `.env.example`, `README.md`, `CLAUDE.md`.

`architecture-guardian`, `security-reviewer` e `performance-monitor` disparam
sozinhos contra este diff (B19) — os arquivos tocados batem com as condições de
trigger dos três. Reportar ao Orchestrator ao fim de cada parada; **não invocar
outro agente**.
