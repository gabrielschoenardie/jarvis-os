# Vault Brain Híbrido — memória semântica local + sync cifrado

## Context

**O que já existe hoje** (tudo mergeado na `main`, até o PR #68):

| Camada | Estado | Onde |
|---|---|---|
| Escrita (Capture) | ✅ pronto (#56) | `chatCapture.js` → `00-Inbox/Capture <data> <hora>.md` |
| Leitura (retrieval) | ✅ **semântica local** (#68) | `useVaultIndex.js` → busca por relevância + recência no navegador |
| Inspetor | ✅ pronto (#64) | `MemoryPanel.jsx`, aberto pela cinta |

Então a resposta à pergunta "ele fica mais inteligente conforme a gente conversa?" é: **sim, 100% local, zero rede**. Cada conversa vira nota no vault, e a indexação semântica (embeddings ONNX) recupera as notas mais relevantes por conteúdo, não só por data. Uma nota escrita há 3 meses sobre exatamente o assunto da pergunta **é recuperada agora**, e uma `lista-compras.md` salva ontem não aparece em conversa técnica.

**O que este plano constrói**: uma camada de **sync cifrado entre dispositivos** para que o índice semântico (as embeddings e o grafo de relevância) siga o usuário sem depender de Vercel ou de qualquer custo.

Decisões travadas com o usuário:
1. **Embeddings locais** — modelo ONNX self-hosted, nenhum texto de nota sai da máquina para indexar. ✅ **Fase A, mergeada.**
2. **Cloud = sync de índice cifrado** — blob AES-GCM, servidor não lê nada. **Fase B, este documento.**
3. **Fase B usa Cloudflare R2** — free tier 10GB/mês, S3-compatible, zero egress fees.

### Por que embeddings locais encaixam nesta stack sem dependência nova pesada

`onnxruntime-web` **já é dependência** (`package.json`) porque o VAD de voz o usa, e o `vite.config.js` já copia os `.wasm` dele para a raiz de `/`. O app já roda sob `Cross-Origin-Embedder-Policy: require-corp` com `crossOriginIsolated === true`, ou seja, **SharedArrayBuffer disponível** — que é justamente o que o ORT precisa para o wasm com threads. O precedente de self-hospedar asset de modelo (`silero_vad_legacy.onnx`) e fontes já está estabelecido. Nada disso é território novo para o projeto.

---

## Fase A — busca semântica local

### A1. Modelo e runtime

- Modelo: **`Xenova/multilingual-e5-small`** — 384 dimensões, multilíngue (PT-BR é primeira classe), variante quantizada q8 ≈ 35 MB.
- Biblioteca: `@huggingface/transformers` (v3).
- ⚠️ **O modelo NÃO pode vir do CDN da HuggingFace**: COEP `require-corp` bloqueia terceiros sem CORP, e além disso baixar de terceiro contradiz a premissa de privacidade. Self-hospedar em `public/models/`:
  ```js
  env.allowRemoteModels = false;
  env.localModelPath = '/models/';
  env.backends.onnx.wasm.wasmPaths = '/';  // reusa os .wasm já copiados
  ```
- Download do modelo via `scripts/fetch-embedding-model.mjs` rodado no `postinstall` (assim o build da Vercel também o busca), com `public/models/` no `.gitignore` — não commitar 35 MB.
- **E5 exige prefixos**: `"query: "` ao embutir a pergunta, `"passage: "` ao embutir chunks de nota. Errar isso degrada a qualidade silenciosamente.

**Risco nº 1 — dois runtimes ONNX.** `@huggingface/transformers` traz sua própria versão de `onnxruntime-web`, que pode conflitar com a `^1.26.0` já pinada pelo VAD (disputa por `wasmPaths`, threads, SharedArrayBuffer). Mitigação, que também é a decisão certa por outros motivos: **rodar o embedder dentro de um Web Worker** (`src/workers/embedder.worker.js`). Escopo de módulo separado elimina a maior parte do conflito e evita travar a UI durante uma indexação de milhares de notas. Depois de integrar, **testar explicitamente que a voz/VAD continua funcionando** — é o canário deste risco.

### A2. Arquivos novos

| Arquivo | Responsabilidade |
|---|---|
| `src/workers/embedder.worker.js` | Carrega o modelo, recebe lotes de texto, devolve `Float32Array` normalizado. Reporta progresso. |
| `src/lib/embedder.js` | Cliente main-thread do worker: promessas sobre `postMessage`, fila, warm-up. |
| `src/lib/chunker.js` | Puro. Corta o corpo da nota (sem frontmatter) em blocos de ~900 chars com ~150 de overlap, quebrando em `\n\n`/heading. |
| `src/lib/vectorIndex.js` | Puro. `diffIndex(graph, index)` → `{ toEmbed, toRemove }`; `packIndex`/`unpackIndex`; `search(index, queryVec, k)` por cosseno. |
| `src/hooks/useVaultIndex.js` | Orquestra: diff → `readNote` só das mudadas → chunk → embed → persiste → expõe `search()`, `status`, `progress`. |
| `scripts/fetch-embedding-model.mjs` | Baixa o modelo para `public/models/` (postinstall). |

### A3. Formato do índice e persistência

Um único blob em IndexedDB sob a chave `jarvis-vault-index`, via o `idbGet`/`idbSet` que **já existem** em `src/lib/idb.js` — `Float32Array` é structured-cloneable, então **não precisa mexer no schema nem versionar o DB**. Formato:

```js
{
  version: 1,
  model: 'multilingual-e5-small',
  dims: 384,
  updatedAt: <epoch>,
  deviceId: <uuid>,              // B1: novo, pra conflict resolution
  notes: { [path]: { mtime, title, chunkStart, chunkCount } },
  chunks: [{ path, text }],        // texto do trecho, para montar o prompt
  vectors: Float32Array            // packed: chunk i ocupa [i*384, (i+1)*384)
}
```

Vetores **normalizados na indexação** → similaridade de cosseno vira produto escalar puro. Busca é força bruta: 5.000 chunks × 384 dims ≈ 2M multiply-adds, poucos milissegundos em JS. **Nenhuma biblioteca de ANN necessária.**

Tamanho: 384 × 4 bytes = 1,5 KB por chunk. Um vault de 3.000 notas ≈ 5.000 chunks ≈ **8 MB**. Confortável para IndexedDB e para o sync da Fase B.

### A4. Indexação incremental (obrigatório, não otimização)

Re-embutir o vault inteiro a cada scan é inviável. `walkVault` em `useVault.js` **já descarta o corpo** das notas (só guarda metadata + `targets`), então o indexador relê via `readNote(path)` — exatamente o padrão que o `useEffect` de `memoryContext` já usa hoje para 5 notas.

Diff por `mtime`, que `buildGraph` já expõe em cada nó:
- nó no grafo e ausente do índice, **ou** `mtime` maior → re-embutir;
- caminho no índice e ausente do grafo → remover.

Rodar em background após `scanId` mudar, cancelável (mesmo padrão do efeito atual), em lotes com `await new Promise(r => setTimeout(r, 0))` entre eles para não travar a aba.

### A5. A mudança estrutural — retrieval passa a ser por request

Hoje `memoryContext` é uma **string calculada uma vez por scan**, alheia à mensagem. Busca semântica precisa da pergunta, então isso precisa virar uma chamada por mensagem enviada:

```
ANTES:  scan → memoryContext (string fixa)      → toda mensagem manda a mesma coisa
DEPOIS: mensagem → searchMemory(texto) → contexto sob medida daquela pergunta
```

- `useVault.js`: remove o `useEffect` que precomputa `memoryContext`; passa a expor `searchMemory(queryText)` (async), `indexStatus`, `indexProgress`.
- `useChat.js`: em `submitCommand`, antes de `callClaude`, faz `const memoryContext = await vault.searchMemory(text)`. O parâmetro do hook deixa de ser uma string e vira uma função.
- `App.jsx`: passa `searchMemory` em vez de `memoryContext`.

**Contrato preservado de propósito**: `buildMemoryContext(entries)` continua produzindo exatamente o mesmo formato de texto, com o mesmo teto de 2000 caracteres. Portanto **`jarvis-prompts.js`, `anthropic.js` e `api/chat.js` não mudam em uma linha** — muda só *quais* notas são escolhidas.

**Efeito colateral bom**: o `MemoryPanel` fica mais correto. O critério que ele já declara ("a lista bate exatamente com o que foi enviado no último request") hoje é aproximado; com retrieval por request ele passa a ser literal. Basta `setMemoryDetail(...)` ao fim de cada `searchMemory`.

### A6. Score híbrido — recência não é jogada fora

```
score = 0.75 × cosseno + 0.25 × exp(−idadeEmDias / 30)
```

Recência continua valendo (uma captura de 10 minutos atrás deve ganhar de uma nota tangencial de um ano), só deixa de ser o **único** critério. Deduplicar por nota (melhor chunk de cada nota vence) para não gastar o orçamento de 2000 caracteres com cinco trechos do mesmo arquivo.

### A7. Degradação graciosa (o que impede regressão)

Se o índice não existe, está incompleto, o modelo falhou ao carregar ou o vault está desconectado → **cai no `selectRecentNotes` que já existe hoje**. Pior cenário possível = comportamento atual. Nada de tela de erro, nada de chat quebrado.

### A8. UI

- **Cinta** (`StatusStrip.jsx`): novo item `ÍNDICE` — `1.240/5.100` em ciano enquanto indexa (estado ativo real, coerente com a regra da Etapa 4), some quando termina. Segue depois dos 4 itens prioritários, para não competir no mobile.
- **MemoryPanel**: mostrar o score por nota (ex.: `≈31 tok · 0.82`) e trocar o rodapé `"recência pura, sem busca"` — que passa a ser mentira — por algo como `"busca semântica + recência"`.

### A9. Arquivos tocados na Fase A

**Novos**: os 6 de A2.
**Modificados**: `src/lib/memoryContext.js` (nova entrada a partir de hits de busca, mantendo `selectRecentNotes` como fallback e o formato de saída intacto) · `src/hooks/useVault.js` · `src/hooks/useChat.js` · `src/App.jsx` · `src/components/StatusStrip.jsx` · `src/components/MemoryPanel.jsx` · `vite.config.js` · `package.json` · `README.md`.

---

## Fase B v4 — sync de índice cifrado com Cloudflare R2

> **Status: especificação, não ordem de execução.** Este capítulo descreve o
> que a Fase B *deve ser* quando for implementada. Nada aqui autoriza mexer em
> `src/`, `api/`, `package.json`, `vite.config.js` ou `.env` agora. A Fase B
> começa quando o operador abrir explicitamente o PR 1 descrito em B18 —
> e só depois da Fase A/A.1 estarem mergeadas e rodando (PR #68 ✅).

### Histórico de revisões

| Rev | O que era | Por que caiu |
| --- | --- | --- |
| v2 | Proxy: o blob inteiro sobe no corpo de `PUT /api/memory-sync`; `ciphertext` dentro de JSON; `authTag` como campo próprio; CORS `*`; passphrase em `localStorage` | Teto de corpo da Vercel (~4–4,5 MB) contra um índice de ~8 MB; `JSON.stringify` de `Uint8Array` infla várias vezes; `authTag` separado não é implementável em WebCrypto; endpoint sem autenticação nenhuma |
| v3 | Presigned URLs (o navegador transfere, a função só assina); corpo binário puro; Edge + `aws4fetch`; passphrase só em sessão | Corrigiu o transporte, mas manteve três defeitos de segurança/concorrência — ver abaixo |
| **v4** | **Esta revisão** | Separa segredo de cifragem de capability de sync; salt aleatório público; concorrência otimista por `ETag`; envelope binário versionado; CORS do bucket como item de infraestrutura; threat model explícito; custo corrigido |

**Os três defeitos da v3 que a v4 corrige:**

1. **`objectId` derivado da passphrase.** A v3 usava
   `PBKDF2(passphrase) → [chaveAES | objectId]` e chamava isso de
   "capability-based". Na prática promovia uma senha humana de baixa entropia
   a credencial de autorização do endpoint. → **B2**.
2. **Salt determinístico** (`SHA-256("jarvis-os/v1" + passphrase)`), aceito na
   v3 como preço do bootstrap de um segundo dispositivo. Com a capability
   transportada separadamente (B2), esse argumento deixa de existir e o salt
   volta a ser aleatório. → **B3**.
3. **Last-write-wins pelo relógio do dispositivo.** `updatedAt + deviceId`
   decidiam sobrescrita. Relógio de cliente não é fonte de verdade para
   concorrência. → **B6**.

**Decisões da v3 preservadas sem alteração:** Cloudflare R2; URLs
pré-assinadas com transferência direta navegador↔R2 (a função nunca vê bytes
do índice); signer em **Edge runtime**, proibido de usar API de Node
(`Buffer`, `node:crypto`); `aws4fetch` como dependência deliberada para o
SigV4; corpo do objeto **binário puro**, sem JSON envolvendo; **sem campo
`authTag`** (o WebCrypto anexa a tag ao ciphertext no AES-GCM e não expõe API
para obtê-la separada); passphrase **nunca persistida**, só em estado React de
sessão; AES-256-GCM; PBKDF2-HMAC-SHA256 com **600.000 iterações**; `HEAD` para
checar frescor sem baixar o blob; feature flag isolando a Fase A; dois PRs;
item `CLOUD` na cinta só enquanto sincroniza.

**Invariantes de produto que a Fase B não pode tocar:** o modelo de embeddings
continua `Xenova/multilingual-e5-small` q8 384 dims, self-hospedado, rodando no
Worker; **retrieval é local e independente de rede**; sync é uma camada
lateral que só move bytes já cifrados.

---

### B0. Ponto de partida

#### B0.0 As-built da Fase A/A.1 — o que o serializer da Fase B realmente vai serializar

A seção A3 acima é o plano **original** da Fase A e ficou desatualizada quando
a Fase A.1 mergeou. A Fase B deve ser especificada contra o código de hoje,
não contra o A3. Reconciliação:

| Item | A3 (plano v1) | As-built hoje (`useVaultIndex.js`) |
| --- | --- | --- |
| `version` do índice | `1` | `INDEX_VERSION = 2` (a Fase A.1 acrescentou campos estruturais ao chunk) |
| Guarda de compatibilidade | inline no hook | `isIndexCompatible(saved, { version, model, dims })` em `vectorIndex.js` |
| Pack/unpack | `packIndex`/`unpackIndex` | `packVectors(vectorList, dims)` / `unpackVector(packed, i, dims)` |
| Registro de chunk | `{ path, text }` | `{ path, title, heading, headingPath, chunkIndex, text }` |
| `deviceId` dentro do índice | previsto em A3 | **não existe** — nunca foi implementado. A Fase B o introduz **fora** do índice (`deviceId.js`), como metadado do envelope |
| `embeddingText` | — | montado na indexação (título + `Seção: headingPath` + corpo), embutido, e **nunca persistido** — é derivável e dobraria o tamanho do índice |

Forma real do objeto em IndexedDB sob `jarvis-vault-index`:

```js
{
  version: 2,
  model: 'multilingual-e5-small',
  dims: 384,
  updatedAt: 0,                    // epoch ms
  notes:  { /* [path]: { mtime, title, chunkStart, chunkCount } */ },
  chunks: [ /* { path, title, heading, headingPath, chunkIndex, text } */ ],
  vectors: new Float32Array(0)     // packed: chunk i em [i*384, (i+1)*384)
}
```

**Consequência normativa para B5:** o serializer serializa **exatamente esta
forma** e nada mais. Não reintroduz `embeddingText` e não reintroduz `deviceId`
dentro do índice — `deviceId` entra no `meta` do envelope, vindo por parâmetro.

**De onde vêm `version`, `model` e `dims`.** De lugar nenhum novo: o próprio
objeto de índice já os carrega (ver a forma acima), então `serializeIndex` lê os
três **do índice que recebeu**. Na leitura, `deserializeIndex` recebe os valores
esperados **por parâmetro**, do chamador — que é quem conhece `INDEX_VERSION`,
`MODEL_ID` e `DIMS`.

O serializer, portanto, **não declara nenhuma constante de modelo ou de versão e
não importa `useVaultIndex.js`**. Importar o hook arrastaria React para dentro de
um módulo que precisa rodar puro sob `node --test`; duplicar as constantes criaria
uma segunda fonte da verdade que sairia de sincronia no próximo bump de
`INDEX_VERSION`. As duas saídas erradas se evitam pela mesma decisão.

#### B0.1 Etapa obrigatória — remover o `api/memory-sync.js` legado

`api/memory-sync.js` **já existe na `main`** (commitado direto, em `0344d97`)
e **não funciona**. Três defeitos, todos fatais:

1. Declara `export const config = { runtime: 'edge' }` mas usa `Buffer`, que
   não existe no Edge Runtime (isolate V8, não Node) — `ReferenceError` na
   primeira chamada.
2. `hashSHA256()` devolve um hex falso e `hmacSHA256()` devolve a string
   literal `'xxxxxxxx'`; os próprios comentários no arquivo admitem
   (`// fake, replace com real hash`, `// Placeholder`). A assinatura SigV4
   nunca seria válida e o R2 rejeitaria tudo.
3. Roteia o blob inteiro pelo servidor — o desenho que B1 descarta —, com
   `Access-Control-Allow-Origin: '*'` e sem validação nenhuma de quem escreve.

Regras da v4 sobre esse arquivo, mais duras que as da v3:

- ❌ **Não é base da nova implementação.** Começar dele é herdar os três
  problemas. Nem a estrutura de handlers nem o roteamento `GET`/`PUT` dele
  sobrevivem — o contrato novo é um signer, não um proxy (B9).
- ❌ **Não deve ser reutilizado**, nem parcialmente. Nenhuma função dele é
  aproveitável.
- ❌ **Não deve permanecer como endpoint funcional** da arquitetura futura.
- ✅ **`B0.1` é uma etapa explícita e a primeira do PR 2**: apagar o arquivo e
  substituí-lo pelo signer, num commit próprio, para que o diff mostre que o
  código morto saiu em vez de ter sido remendado.
- ✅ **Enquanto a Fase B não estiver implementada, nada muda.** Nada em `src/`
  importa esse arquivo; ele é código morto e o app segue funcionando. Não
  apagá-lo agora é decisão consciente: esta revisão é documental.

---

### B1. Arquitetura — a função assina, o navegador transfere

```text
1. Browser  → GET  /api/memory-sync?op=put&objectId=…   (Edge, resposta ~1 KB)
2. Signer   → URL R2 pré-assinada, TTL 5 min, escopada àquele objeto
3. Browser  → PUT <url-r2>   (os ~8 MB vão DIRETO pro R2, sem tocar a Vercel)
```

Isso resolve três coisas de uma vez: some o teto de corpo de requisição da
Vercel (~4–4,5 MB, contra um índice de ~8 MB que comprime mal porque o grosso
são vetores `Float32` normalizados); some o egress pela Vercel (o R2 não cobra
egress); e as credenciais R2 continuam só no servidor — o navegador nunca as vê.

**Runtime: Edge.** Com o proxy fora do caminho a função só faz assinatura —
trabalho pequeno, sem `Buffer`, sem streaming de corpo grande. A regra que isso
impõe é dura: **nenhuma API de Node nesse arquivo**.

**Dependência deliberada: `aws4fetch`** (~6 KB, feito para edge/Workers, usa
WebCrypto, suporta `signQuery: true` para pré-assinatura). O B9 da v2 exigia
"nenhuma dependência nova" e foi exatamente essa restrição que produziu o
SigV4 falso de B0.1: SigV4 na mão são ~80 linhas de canonicalização traiçoeira
que precisariam dos próprios testes. Vale a dependência.

---

### B2. Modelo de segredos — passphrase ≠ capability

A v3 fundia dois papéis num segredo só. A v4 separa:

| Segredo | Papel | Entropia | Onde vive | Sai da máquina? |
| --- | --- | --- | --- | --- |
| **Passphrase** | deriva a chave AES-256-GCM | humana, baixa | só em estado React da sessão | **nunca** |
| **Sync secret** (capability) | identifica/autoriza o objeto no R2 | 256 bits, `crypto.getRandomValues` | IndexedDB local, e transportada à mão para o 2º dispositivo | só como código de sync, fora de banda |

```text
syncSecret = crypto.getRandomValues(new Uint8Array(32))   // 256 bits, gerado no cliente
objectId   = hex(SHA-256(syncSecret))                     // 64 chars hex — identificador público

passphrase
   ↓  PBKDF2-HMAC-SHA256(salt aleatório, 600.000, SHA-256)
chave AES-256-GCM
```

**O que o servidor sabe:** o `objectId`. Nada mais. Não conhece a passphrase,
não conhece a chave AES, não conhece o `syncSecret`, não vê ciphertext.

**Por que hashear o `syncSecret` em vez de usá-lo como nome do objeto.** O
`objectId` viaja na query string de toda chamada ao signer; o `syncSecret`
não. Um observador da chamada ao signer aprende o nome do objeto, mas não o
segredo que o gera. O ganho hoje é modesto — na v4 o `objectId` **é** a bearer
capability no fio, e quem o conhece pode pedir URLs — mas é o que abre o
caminho de endurecimento futuro descrito em B2.1 sem trocar o formato do
objeto nem o nome das coisas.

**O que isso compra em relação à v3:** força bruta contra o endpoint deixa de
ser força bruta contra uma senha humana. Adivinhar um `objectId` válido é
adivinhar 256 bits, não uma passphrase.

**Persistência do `syncSecret`.** Fica em IndexedDB, na mesma store do índice.
É um trade-off consciente e assimétrico ao da passphrase: quem obtém o
`syncSecret` de uma máquina consegue **sobrescrever ou corromper** o objeto
remoto, mas **não consegue lê-lo** — sem a passphrase não há chave AES. Por
isso ele pode repousar no navegador e a passphrase não pode.

**Isto continua não sendo um sistema de login.** Não há contas, não há
usuários, não há sessão de servidor. O modelo é pessoal e capability-based; a
v4 só troca uma capability fraca (derivada de senha) por uma forte (aleatória).

#### B2.1 Como o segundo dispositivo obtém a capability

Especificado aqui, **não implementado nesta revisão**; a UI entra no PR 2.

- O dispositivo A exibe o `syncSecret` como **código de sincronização**: os 32
  bytes em Base32 sem ambiguidade visual (sem `0`/`O`, `1`/`I`), agrupado em
  blocos para digitação, ou como QR.
- O transporte é **fora de banda e manual** — o operador lê e digita, ou
  escaneia. Nenhum servidor intermedia o pareamento; nada de e-mail de
  convite, nada de canal de sinalização.
- O dispositivo B recebe o código, recalcula `objectId = SHA-256(syncSecret)`,
  pede uma URL de `GET`, baixa o objeto, lê o **salt do envelope** (B3/B4),
  pede a passphrase ao operador e deriva a mesma chave.
- Regra: o código de sync **nunca** é logado, nunca vai para telemetria, nunca
  aparece em URL, e a tela que o exibe exige uma ação explícita para revelar.
- Fora de escopo desta fase: rotação de capability, revogação, mais de dois
  dispositivos com identidades distintas, e prova de posse do `syncSecret`
  perante o signer (um HMAC sobre a requisição, que substituiria o `objectId`
  como credencial no fio). Ficam registrados como caminho futuro, não como
  requisito da v4.

---

### B3. Derivação de chave e salt aleatório

```text
salt  = crypto.getRandomValues(new Uint8Array(16))   // gerado UMA vez, na criação do objeto
chave = PBKDF2-HMAC-SHA256(passphrase, salt, 600_000, dkLen = 32)  → AES-256-GCM
```

**O salt não é segredo.** É um valor público cuja única função é impedir que
uma tabela pré-computada sirva para mais de um alvo. Por isso ele pode — e
deve — viajar **em claro** junto do objeto cifrado, no cabeçalho do envelope
(B4). Nada se perde ao publicá-lo.

Por que isso resolve o bootstrap que travou a v3: o segundo dispositivo não
precisa mais *derivar* nem *adivinhar* nada de contexto. Ele obtém o
`objectId` da capability (B2.1), **baixa o objeto**, e o salt vem dentro. Mesma
passphrase + mesmo salt ⇒ mesma chave. A v3 só precisou de salt determinístico
porque tinha atado o nome do objeto à passphrase; desfeito esse nó, a razão
some.

Regras:

- O salt é gerado **uma vez**, quando o objeto de sync é criado, e é
  **preservado** em todas as reescritas subsequentes. Regerar salt a cada PUT
  invalidaria a chave já em uso no outro dispositivo.
- O **IV do AES-GCM é diferente a cada cifragem** (12 bytes aleatórios) e
  também viaja em claro no cabeçalho. Salt e IV são coisas distintas: salt é
  por objeto, IV é por escrita. Reutilizar IV com a mesma chave em GCM é
  catastrófico, e é por isso que ele nunca é derivado nem reaproveitado.
- **A passphrase não é persistida em lugar nenhum** — nem `localStorage`, nem
  IndexedDB, nem `sessionStorage`. O operador redigita a cada sessão, por design.
- **KDF preservado.** Continua PBKDF2-HMAC-SHA256 com ordem de grandeza de
  600.000 iterações. A v4 não troca de KDF: Argon2id seria melhor em teoria,
  mas exigiria WASM novo num app que já disputa runtime ONNX (ver "Risco nº 1"
  da Fase A), e PBKDF2 é nativo no WebCrypto. A contagem de iterações fica
  gravada no cabeçalho (B4) para que um aumento futuro seja legível por
  clientes antigos sem quebrar objetos existentes.

---

### B4. Formato do objeto no R2 — cabeçalho em claro + ciphertext

Corpo **binário puro** (`Content-Type: application/octet-stream`), sem JSON
envolvendo. A v2 especificava `ciphertext: Uint8Array` dentro de JSON;
`JSON.stringify` de um `Uint8Array` produz `{"0":12,"1":45,…}`, várias vezes o
tamanho original — proibitivo para 8 MB.

```text
offset  tam  campo
------  ---  --------------------------------------------------------------
   0     8   magic          ASCII "JVSYNC01"
   8     1   containerVer   = 1
   9     1   kdfId          = 1  (PBKDF2-HMAC-SHA256)
  10     4   iterations     uint32 BE (= 600000)
  14     1   saltLen        = 16
  15    16   salt           bytes aleatórios, EM CLARO (B3)
  31     1   ivLen          = 12
  32    12   iv             bytes aleatórios, EM CLARO, novo a cada escrita
------  ---  --------------------------------------------------------------
  44     N   ciphertext     AES-256-GCM(payload) com a tag JÁ ANEXADA
```

- Os **44 bytes de cabeçalho são passados como `additionalData` (AAD)** na
  cifragem e na decifragem. Consequência: mexer em `iterations`, `salt` ou
  `iv` faz a decifragem falhar na tag, em vez de produzir lixo silencioso.
- **Não existe campo `authTag`.** O WebCrypto devolve a tag anexada ao
  ciphertext e não há API para separá-la. Isso não é escolha, é a forma da API.
- O `payload` cifrado é o **envelope do serializer** descrito em B5.

**Metadados em headers S3** (`x-amz-meta-*`, incluídos na assinatura e
liberados no CORS do bucket — B7):

```text
x-amz-meta-updated-at: <epoch ms>
x-amz-meta-device-id:  <uuid do dispositivo que escreveu>
x-amz-meta-version:    1
```

Servem para **diagnóstico e UI** — "escrito por *este* dispositivo há 3
minutos" —, legíveis por um `HEAD` de ~1 KB em vez de um download de 8 MB.
**Não são fonte de verdade para concorrência**: quem decide isso é o `ETag` (B6).

**Chave do objeto no bucket:** `idx/<objectId>` — prefixo fixo, `objectId`
validado contra `^[0-9a-f]{64}$` antes de ser concatenado. Um objeto por
capability; sem versionamento de bucket (ver B13).

---

### B5. Serializer — envelope binário versionado

Bytes não são um índice. `indexSerialize.js` não pode converter um
`ArrayBuffer` em objeto de índice sem antes provar que aqueles bytes *são* um
índice compatível — mesmo depois de o AES-GCM autenticar a origem, resta o caso
do índice legítimo porém de outra versão, ou de outro modelo.

```text
offset      tam  campo
----------  ---  ---------------------------------------------------------
   0          8  magic          ASCII "JVIDXV01"
   8          1  envelopeVer    = 1
   9          2  indexVersion   uint16 BE  (= INDEX_VERSION corrente, hoje 2)
  11          2  dims           uint16 BE  (= 384)
  13          1  modelIdLen     uint8
  14          L  modelId        UTF-8 ("multilingual-e5-small")
  14+L        8  updatedAt      uint64 BE (epoch ms)
  22+L        4  payloadLen     uint32 BE
  26+L        N  payload
----------  ---  ---------------------------------------------------------

payload:
   0          4  jsonLen        uint32 BE
   4          J  meta           UTF-8 JSON: { notes, chunks, deviceId }
   4+J        V  vectors        chunkCount * dims * 4 bytes, Float32 LITTLE-ENDIAN
```

- **Endianness é fixada, não herdada.** `Float32Array` usa a endianness da
  plataforma; a leitura e a escrita dos vetores passam por `DataView` com
  `littleEndian = true` explícito, para que o formato não dependa da máquina
  que gravou.
- **`meta` carrega exatamente o as-built de B0.0** — `notes` e `chunks` como
  estão em `useVaultIndex.js`. **`embeddingText` não é serializado**: é
  derivável do chunk e dobraria o tamanho, exatamente como já não é persistido
  em IndexedDB hoje.
- A conversão `Float32Array` ↔ `ArrayBuffer` continua sendo o trabalho real do
  módulo; o envelope é a moldura em volta dela.

**Validação na leitura — ordem e falha explícita.** Qualquer item abaixo que
falhe rejeita o blob inteiro com um erro tipado; **nunca** se constrói um
índice parcial a partir de bytes suspeitos. `INDEX_VERSION`, `MODEL_ID` e `DIMS`
na tabela são os valores **esperados, recebidos por parâmetro** do chamador — o
serializer não os declara nem os importa (B0.0):

| Checagem | Falha significa |
| --- | --- |
| `magic === "JVIDXV01"` | não é um índice do JARVIS — blob errado ou corrompido |
| `envelopeVer` conhecido | formato de envelope de outra época |
| `indexVersion === INDEX_VERSION` | índice de outra versão de esquema (ex.: v1 pré-A.1) |
| `modelId === MODEL_ID` | índice de outro modelo de embeddings |
| `dims === DIMS` | dimensionalidade incompatível |
| `payloadLen` igual aos bytes restantes | payload truncado |
| `jsonLen` cabe no payload e o JSON parseia | metadados corrompidos |
| `V === chunks.length * dims * 4` | contagem de vetores não bate com a de chunks |

**Comportamento em rejeição:** o índice **local** não é tocado. O painel avisa
que o objeto remoto é incompatível e oferece sobrescrevê-lo com o local — que
é o caminho correto quando o remoto ficou para trás depois de um bump de
`INDEX_VERSION`. Rejeição remota nunca dispara descarte local; isso é
deliberado e distinto da guarda de `isIndexCompatible` em `vectorIndex.js`, que
descarta o índice **local** incompatível porque ele é reconstruível a partir do
vault a qualquer momento.

---

### B6. Concorrência — `ETag` e PUT condicional, não relógio

A v3 decidia sobrescrita por `updatedAt + deviceId` (last-write-wins). Relógio
de cliente não é fonte de verdade: dois dispositivos com horários
dessincronizados fazem o mais atrasado ganhar, e o índice do outro some sem aviso.

Na v4 `updatedAt` e `deviceId` **continuam existindo** como metadados de UI e
diagnóstico, e **deixam de ser** a proteção de concorrência. A proteção é
otimista, pelo `ETag` que o próprio R2 emite:

```text
HEAD remoto
   ↓
ETag conhecido?  (o último que este dispositivo viu, persistido junto do índice)
   ↓
PUT condicional  (If-Match: <etag>  ·  ou If-None-Match: * na primeira escrita)
   ↓
ETag mudou no meio  →  412 Precondition Failed  →  CONFLITO
   ↓
NÃO sobrescrever silenciosamente
   ↓
o operador escolhe:  CARREGAR DO CLOUD   ou   MANTER LOCAL
```

Regras:

- O `ETag` da última escrita/leitura bem-sucedida é persistido localmente ao
  lado do índice. É o único estado de concorrência que importa.
- **Primeira escrita:** `If-None-Match: *` — cria só se não existir. Se já
  existir, é conflito, não sobrescrita.
- **Escritas seguintes:** `If-Match: <etag conhecido>`.
- **`412` nunca é retentado automaticamente com força.** Retry só é seguro
  para erro de rede/5xx com a mesma pré-condição; um `412` significa que
  alguém escreveu, e a decisão é do operador.
- **`MANTER LOCAL`** é a única porta para sobrescrita, e exige ação explícita:
  o cliente refaz `HEAD`, adota o `ETag` novo e reenvia com `If-Match` daquele
  ETag. Ou seja, mesmo o "forçar" continua condicional — só que sobre um estado
  que o operador viu.
- **Implicação de assinatura, a verificar num spike no início do PR 2:** o
  cabeçalho condicional precisa estar em `SignedHeaders` da URL pré-assinada,
  então seu **valor tem que ser conhecido no momento de assinar**. Por isso o
  cliente envia o `ETag` esperado ao signer (`&ifMatch=…`) e o navegador repete
  o cabeçalho exatamente. Se o spike mostrar que o R2 não honra condicional em
  URL query-signed, a alternativa é `HEAD`-antes-do-`PUT` com janela de corrida
  assumida e documentada — mas a preferência é a condicional real.
- O `ETag` só é legível pelo JS se o CORS do bucket o expuser (B7). Sem isso,
  todo este mecanismo falha silenciosamente com `ETag === null`.

---

### B7. CORS do bucket R2 — item de infraestrutura, não detalhe

**A v3 não tratava disso e por isso não fechava.** Como a transferência é
**direta do navegador para o R2** (B1), quem responde ao preflight é o **R2**,
não a Vercel. Os headers CORS que o signer devolve valem só para a chamada ao
signer; não cobrem nem um byte da transferência real. Um `PUT` com
`Content-Type` e `If-Match` é uma requisição não-simples: dispara `OPTIONS`
antes, e sem política de CORS no bucket o navegador aborta com um erro de rede
opaco — sem status, sem corpo, difícil de diagnosticar.

Política a aplicar no bucket (R2 Dashboard → bucket → Settings → CORS Policy),
**antes** de qualquer teste de integração do PR 2:

```json
[
  {
    "AllowedOrigins": [
      "https://<origem-de-producao-do-jarvis>"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": [
      "content-type",
      "if-match",
      "if-none-match",
      "x-amz-meta-updated-at",
      "x-amz-meta-device-id",
      "x-amz-meta-version"
    ],
    "ExposeHeaders": [
      "ETag",
      "Content-Length",
      "Last-Modified",
      "x-amz-meta-updated-at",
      "x-amz-meta-device-id",
      "x-amz-meta-version"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

- **`AllowedOrigins` é a origem exata de produção.** Nunca
  `Access-Control-Allow-Origin: *` num bucket pessoal: com `*`, qualquer página
  que o operador visite pode falar com o bucket a partir do navegador dele. O
  ciphertext protege o conteúdo, não a integridade nem a disponibilidade.
- **`http://localhost:5173` entra apenas enquanto se desenvolve**, como entrada
  adicional e temporária, e sai antes de considerar a fase pronta. Documentar a
  remoção como item do checklist de deploy, não como configuração permanente.
- **`ExposeHeaders` com `ETag` é obrigatório** — sem ele,
  `response.headers.get('ETag')` devolve `null` no navegador e o controle
  otimista de B6 morre em silêncio.
- **`AllowedMethods` não inclui `DELETE`.** A arquitetura não apaga objetos
  remotos; reduzir a superfície é de graça.
- Os `x-amz-meta-*` precisam aparecer **nos dois lados**: em `AllowedHeaders`
  para o navegador poder enviá-los no `PUT`, e em `ExposeHeaders` para poder
  lê-los na resposta do `HEAD`.

---

### B8. Presigned URLs — regras de manuseio

Uma URL pré-assinada **é a credencial**. Quem a tem, faz a operação que ela
autoriza, sem mais nada.

- **TTL curto: 5 minutos** (`X-Amz-Expires=300`). Suficiente para 8 MB numa
  conexão ruim, curto o bastante para que um vazamento envelheça rápido.
- **Escopada ao objeto e ao método.** Uma URL de `PUT` para `idx/<objectId>`
  não serve para ler outro objeto nem para outro verbo.
- **Nunca armazenada.** Não vai para `localStorage`, IndexedDB, estado
  persistido, nem cache de resposta. Vive numa variável, é usada, é descartada.
- **Nunca logada.** Não em `console.log`, não em telemetria, não em relatório
  de erro. Ao registrar falha de sync, registrar o **status** e o **verbo**,
  jamais a URL.
- **Usada diretamente pelo navegador.** O servidor não retransmite o blob — se
  algum dia retransmitisse, todo o argumento de B1 e de B10 cairia junto.
- **Resposta do signer com `Cache-Control: no-store`**, para que nenhuma camada
  intermediária guarde uma capability.
- Expirada é estado normal, não erro de programa: o cliente pede outra e
  recomeça a operação (ver B15).

---

### B9. O signer — contrato de `api/memory-sync.js` (substituto)

```text
GET /api/memory-sync?op=<head|get|put>&objectId=<64 hex>[&ifMatch=<etag>|&ifNoneMatch=*]
   → 200  { url, method, expiresAt, headers: { … } }   ~1 KB, Cache-Control: no-store
   → 400  objectId ou op inválidos
   → 405  qualquer método que não seja GET (ou OPTIONS de preflight)
   → 501  R2 não configurado no ambiente
```

O signer:

- **não recebe o ciphertext** — não tem corpo de requisição, e o único método
  aceito é `GET`;
- **não faz proxy** e não retransmite bytes do índice;
- **valida a capability**: `objectId` contra `^[0-9a-f]{64}$` e `op` contra a
  allowlist, **antes** de assinar. Sem isso vira um assinador genérico de
  caminhos arbitrários no bucket;
- **monta a chave como `idx/<objectId>`**, prefixo fixo, sem nenhuma outra
  entrada do cliente chegando a uma posição de caminho;
- **gera URL curta e escopada** (5 min, método e objeto fixos — B8);
- **nunca expõe credenciais R2**: `CLOUDFLARE_R2_KEY`/`_SECRET` só existem em
  `process.env` no Edge e nunca entram numa resposta;
- responde `Access-Control-Allow-Origin` com a **origem exata do app**, nunca
  `*` (esta é a CORS do signer, distinta e adicional à CORS do bucket em B7);
- **não loga `objectId` inteiro** — ele é a bearer capability no fio. Log de
  erro registra o verbo, o status e, no máximo, um prefixo curto do id;
- roda em **Edge**: proibido `Buffer`, `node:crypto`, `fs` e qualquer API de
  Node — foi o primeiro defeito do arquivo legado (B0.1).

---

### B10. Threat model

Honesto nos dois sentidos: o que a Fase B protege, e o que ela explicitamente
não protege.

**Protege contra:**

- **Vazamento de conteúdo em claro no servidor.** Nada em claro trafega ou
  repousa fora do navegador. O que sai já está cifrado.
- **O operador do R2 lendo o índice.** A Cloudflare guarda um blob opaco: 44
  bytes de cabeçalho e ciphertext AES-256-GCM.
- **A Vercel lendo o índice.** O signer nunca vê o blob — não tem corpo de
  requisição e não faz proxy (B9).
- **Interceptação sem acesso à chave AES.** Quem capturar o tráfego ou o
  objeto tem ciphertext; sem a passphrase não há chave, e sem chave o GCM não
  entrega nem plaintext nem adulteração indetectada.
- **Adulteração do cabeçalho de cripto.** Salt, IV e contagem de iterações são
  AAD do GCM (B4): alterá-los faz a decifragem falhar, em vez de degradar
  silenciosamente.
- **URLs antigas.** Expiram em 5 minutos e são escopadas a um objeto e um
  método (B8).
- **Força bruta de capability.** O `objectId` deixou de derivar de uma senha
  humana e passou a derivar de 256 bits aleatórios (B2).
- **Sobrescrita cega entre dispositivos.** `If-Match`/`If-None-Match` e o
  fluxo de conflito de B6.

**NÃO protege contra:**

- **Passphrase fraca.** As 600.000 iterações encarecem o ataque; não o
  impedem. Uma passphrase adivinhável derruba tudo, porque ela é a única
  entrada da chave.
- **Perda definitiva da passphrase.** Não há recuperação, não há backup de
  chave, não há reset. O objeto remoto vira lixo irrecuperável e o índice se
  reconstrói do vault local — que continua sendo a fonte de verdade.
- **Malware ou JS malicioso rodando no próprio navegador.** Quem executa
  código na página tem acesso à passphrase digitada e ao índice em claro. Não
  há defesa criptográfica contra isso.
- **Comprometimento da sessão do browser** (extensão hostil, devtools de
  terceiro, perfil compartilhado) — mesma classe do item acima.
- **Quem obtiver passphrase *e* capability.** Junto, é acesso completo por
  construção. É o modelo: dois segredos, ambos necessários.
- **Quem obtiver *só* a capability** (`objectId`, ou o `syncSecret` de uma
  máquina): não consegue **ler** nada, mas pode **corromper ou substituir** o
  objeto remoto por lixo — integridade e disponibilidade, não
  confidencialidade. Mitigação prática: o índice é sempre reconstruível
  localmente a partir do vault, então o dano é recuperável.
- **Abuso do signer por quem conhece um `objectId` válido.** Ele é um endpoint
  público sem autenticação de usuário; a validação de formato e o escopo por
  objeto limitam o estrago a *aquele* objeto, e nada mais. Prova de posse do
  `syncSecret` (B2.1) é o endurecimento futuro para esta linha.
- **Análise de metadados.** Tamanho do objeto e horários de escrita são
  visíveis para quem hospeda. O tamanho do índice vaza a ordem de grandeza do
  vault; a frequência de escrita vaza padrão de uso.

---

### B11. Feature flag e isolamento da Fase A

**Regra dura, e é ela que protege tudo o que já funciona:**

```text
sem VITE_MEMORY_SYNC_ENABLED / sem configuração R2
   ↓
nenhuma operação de sync — nenhum efeito registrado, nenhum fetch disparado
   ↓
a Fase A funciona exatamente como hoje
```

Contrato verificável, não prosa:

- `VITE_MEMORY_SYNC_ENABLED` é **exigida e explícita**. `useIndexSync` retorna
  `{ status: 'disabled' }` e **não registra efeito algum** quando a flag não
  está ligada. Ausência de flag não é "tentar e falhar"; é não existir.
- **`useVaultIndex.js` não muda.** Nem uma linha. O sync lê e escreve o índice
  pelas mesmas funções de `idb.js` que o hook já usa, sem tocar no caminho de
  busca.
- **`memoryContext.js` não muda.** O contrato de montagem de contexto —
  `selectParts`, o teto de `MAX_TOTAL_CHARS = 2000`, `buildMemoryContext` /
  `buildMemoryDetail` — é o mesmo antes e depois da Fase B.
- **Retrieval não depende do cloud.** `searchMemory` nunca aguarda rede, nunca
  consulta o R2, nunca falha por causa de sync.
- **Busca local continua funcionando offline**, com ou sem flag, com ou sem
  índice remoto.
- **Sync é camada lateral**: move um blob para dentro e para fora do IndexedDB;
  não participa de nenhum caminho de leitura do chat.
- O **invariante de privacidade** da Fase A (CLAUDE.md § privacy invariant)
  segue valendo inteiro. A Fase B acrescenta uma única saída de rede nova, e
  ela carrega **apenas ciphertext**: nenhum corpo de nota, nenhum excerpt,
  nenhum embedding em claro deixa o navegador por este caminho.

Ligado:

- **Mount:** `peek()` (`HEAD`) → se o remoto mudou, **oferece** carregar. Não
  baixa sozinho.
- **Após scan bem-sucedido:** `push()` com debounce **longo** (≥ 5 min — são
  ~8 MB por escrita, não os 30 s da v2), ou pela ação manual do painel.

---

### B12. Environment variables

| Categoria | Variável | Onde vive | Segredo? |
| --- | --- | --- | --- |
| **Server-only** | `CLOUDFLARE_ACCOUNT_ID` | env da Vercel, lida só em `api/memory-sync.js` | sim |
| **Server-only** | `CLOUDFLARE_R2_KEY` | idem | **sim** |
| **Server-only** | `CLOUDFLARE_R2_SECRET` | idem | **sim** |
| **Server-only** | `CLOUDFLARE_R2_BUCKET` | idem | não é segredo, mas não há motivo para vazar |
| **Client, feature flag pública** | `VITE_MEMORY_SYNC_ENABLED` | build-time, entra no bundle | **não** |

- **`VITE_MEMORY_SYNC_ENABLED` não é segredo.** Tudo com prefixo `VITE_` é
  inlinado no bundle pelo Vite e é público por construção. Ela só liga e
  desliga a feature; não autoriza nada, não carrega credencial, e ler seu valor
  no bundle não dá acesso a coisa alguma.
- **As credenciais R2 jamais entram em `src/` nem no bundle.** Nenhuma delas
  pode ganhar prefixo `VITE_`, ser importada em componente, hook ou lib, nem
  ser repassada numa resposta do signer. Vale o mesmo regime de
  `ANTHROPIC_API_KEY` e `ELEVENLABS_API_KEY` — é o invariante "API keys never
  reach the browser bundle" do `CLAUDE.md`, estendido ao R2.
- `.env.example` **já documenta** as quatro variáveis de servidor. O que falta
  acrescentar, quando a fase for implementada, é `VITE_MEMORY_SYNC_ENABLED`,
  com a observação de que é pública. **Não fazer agora** — esta revisão é
  documental.
- Como gerar: Dashboard Cloudflare → R2 → criar bucket `jarvis-memory-index`
  (privado) → **aplicar a política de CORS de B7** → API Tokens → Create API
  Token → S3 Client → copiar Access Key ID e Secret. O Account ID está na URL
  do dashboard R2.

---

### B13. Custo — R2 Standard

A v3 dizia "8 MB · free tier 10 GB/mês ≈ 1.250 syncs/mês", **o que estava
errado**: confundia armazenamento (GB-**month**, um estoque) com transferência
(um fluxo). Não são a mesma unidade, e o free tier de armazenamento não se
consome a cada escrita.

Free tier do **R2 Standard**, por mês:

| Recurso | Incluído | Acima disso |
| --- | --- | --- |
| Armazenamento | **10 GB-month** | ~$0,015 / GB-month |
| Operações **Class A** (`PUT`, `POST`, `LIST`) | **1 milhão** | ~$4,50 / milhão |
| Operações **Class B** (`GET`, `HEAD`) | **10 milhões** | ~$0,36 / milhão |
| **Egress** | **sem cobrança** | — |

Premissas explícitas do cenário deste app: **um único objeto** de ~8 MB, sempre
sobrescrito no mesmo lugar; ~2–5 syncs/dia; um `HEAD` no mount e alguns por dia.

- Armazenamento: ~8 MB constantes contra 10 GB-month incluídos — **~0,08% da
  cota**. Sobrescrever não acumula.
- Class A: ~150 `PUT`/mês contra 1 milhão incluídos.
- Class B: algumas centenas de `HEAD`/`GET`/mês contra 10 milhões incluídos.
- Egress: zero, por política do R2 — é a razão principal de o R2 estar aqui em
  vez do S3.

**Na prática: grátis**, com três ordens de grandeza de folga. Os preços acima
são de referência e podem mudar; o que importa é a conclusão (folga enorme para
um uso pessoal de um objeto), não a aritmética.

⚠️ **Uma coisa transformaria isso num custo real: versionamento de bucket
ligado.** Cada `PUT` passaria a reter a versão anterior, e ~8 MB por sync
acumulariam ~1,2 GB/mês num uso moderado. Manter versionamento **desligado**,
ou uma regra de lifecycle apagando versões antigas. Item do checklist de deploy.

---

### B14. UI

**MemoryPanel** (superfície de memória, já existe — `src/components/MemoryPanel.jsx`):

- **Passphrase somente durante a sessão.** Campo que aparece quando o sync está
  ligado, `type="password"`, sem `autocomplete`, sem persistência de nenhum
  tipo. Some ao fechar a aba e é redigitada na sessão seguinte, por design.
- **Sincronização manual.** Ação `SINCRONIZAR` explícita. Nenhum upload
  automático além do `push()` debounced de B11, e nenhum download automático
  nunca.
- **Aviso de remoto mais novo.** Quando o `peek()` detecta `ETag` diferente do
  conhecido: `⚠ ÍNDICE REMOTO DIFERENTE — CARREGAR?`.
- **Escolha explícita do operador** em todo conflito: `CARREGAR DO CLOUD` ou
  `MANTER LOCAL` (B6). Nenhum dos dois acontece sozinho.
- **Estado da última sincronização** em texto — `"sincronizado há 2 minutos"` —
  e qual dispositivo escreveu por último (`x-amz-meta-device-id`), que é o uso
  legítimo desses metadados agora que eles não decidem mais concorrência.
- **Erro de decifragem não destrói dados locais.** Passphrase errada → a tag do
  GCM falha → aviso e retry. O índice local não é apagado, não é substituído e
  não é marcado como inválido. Idem para envelope rejeitado por B5.
- **Código de sincronização** (B2.1): exibir/inserir, atrás de uma ação
  explícita de revelar. Nunca visível por padrão.

**StatusStrip** (`src/components/StatusStrip.jsx`):

- Item `CLOUD` **só enquanto sincroniza**, e some quando termina — exatamente a
  regra que o item `ÍNDICE` da Fase A já segue.
- **Nunca um `CLOUD` permanente em estado ocioso.** Era a proposta da v2 e
  reintroduziria o que o PR #67 removeu: brilho gasto para dizer "nada mudou".
  A regra de leitura da cinta é ciano = estado ativo agora; em repouso, a cinta
  não ganha item nenhum.

---

### B15. Degradação e fallback

- **Sem env vars / flag desligada:** sync inerte, Fase A intacta (B11).
- **Sem internet:** `push` fica pendente; o índice local segue servindo o chat
  normalmente.
- **R2 fora do ar:** loga status, mostra estado no painel, não bloqueia nada.
- **URL expirada (`403`):** estado normal, não erro de programa — pede outra
  URL ao signer e refaz a operação, uma vez. Não entra em laço.
- **Passphrase errada:** `decrypt` falha na tag de autenticação → aviso e
  retry, nada local é destruído.
- **Envelope incompatível (B5):** avisa, oferece sobrescrever o remoto, não
  toca no local.
- **Objeto inexistente — primeiro dispositivo (`404` no `HEAD`/`GET`):**
  estado normal, não é erro. A primeira escrita usa `If-None-Match: *`.
- **`412` no `PUT`:** conflito, fluxo de B6, sem retry automático.
- **Falha de rede genérica em `PUT`:** retry seguro **com a mesma
  pré-condição** (`If-Match` do mesmo ETag), com backoff, limitado. Retry
  jamais relaxa a pré-condição.

---

### B16. Arquivos

**Novos:**

| Arquivo | Responsabilidade |
| --- | --- |
| `src/lib/indexCrypto.js` | Derivação PBKDF2 (B3) + AES-GCM encrypt/decrypt com AAD do cabeçalho (B4). Puro, testável em Node. |
| `src/lib/indexSerialize.js` | Envelope binário versionado (B5): índice ↔ bytes, com todas as validações de leitura. Puro. |
| `src/lib/syncCapability.js` | Geração do `syncSecret`, derivação do `objectId`, codificação/decodificação do código de sync (B2/B2.1). Puro. |
| `src/lib/deviceId.js` | UUID persistido — não é segredo, só identifica quem escreveu (metadado de UI). |
| `src/lib/indexSync.js` | `peek()` (HEAD) / `pull()` / `push()` contra as URLs pré-assinadas, com o controle de `ETag` de B6. |
| `src/hooks/useIndexSync.js` | Coordena `peek()` no mount, `push()` debounced, a ação manual do painel e o estado de conflito. Inerte sem a flag (B11). |
| `api/memory-sync.js` | **Substitui o legado**, que sai antes (B0.1). Edge. Valida `objectId`/`op`, assina URL R2 com `aws4fetch`, devolve ~1 KB. Não vê bytes do índice. |

**Modificados:** `src/hooks/useVault.js` (expor o estado de sync) ·
`src/components/MemoryPanel.jsx` · `src/components/StatusStrip.jsx` ·
`.env.example` (`VITE_MEMORY_SYNC_ENABLED`) · `package.json` (`aws4fetch`) ·
`README.md` e `CLAUDE.md` (nota de privacidade: o índice **cifrado** passa a
sair da máquina).

**Não tocados — e isto é invariante, não conveniência:**
`src/hooks/useVaultIndex.js` · `src/lib/memoryContext.js` ·
`src/lib/vectorIndex.js` · `src/lib/chunker.js` · `src/lib/embedder.js` ·
`src/workers/embedder.worker.js` · `src/lib/jarvis-prompts.js` ·
`src/lib/anthropic.js` · `api/chat.js` · `vite.config.js`.

**Infraestrutura (fora do repo):** política de CORS do bucket (B7),
versionamento desligado (B13), env vars na Vercel (B12).

---

### B17. Testes obrigatórios

**Crypto** (`indexCrypto.test.js`, `syncCapability.test.js` — `node --test`):

- round-trip encrypt → decrypt devolve o plaintext byte a byte;
- passphrase incorreta falha na tag de autenticação (não devolve lixo);
- IV diferente a cada chamada de encrypt (dois ciphertexts do mesmo plaintext
  diferem);
- salt diferente com a mesma passphrase produz chave diferente;
- derivação determinística: mesma passphrase + mesmo salt ⇒ mesma chave, em
  execuções distintas;
- cabeçalho como AAD: alterar `salt`/`iv`/`iterations` no cabeçalho faz o
  decrypt falhar;
- `syncSecret` aleatório: duas gerações não colidem e têm 32 bytes;
- `objectId` determinístico a partir da capability, e no formato
  `^[0-9a-f]{64}$`;
- round-trip do código de sync: `encode(secret)` → `decode` devolve os mesmos
  bytes.

**Serialization** (`indexSerialize.test.js`):

- `Float32Array` preservado **bit a bit** no round-trip, e explicitamente
  little-endian, independente da máquina;
- envelope válido é aceito e reconstrói `notes`/`chunks`/`vectors` idênticos;
- `magic` errado rejeitado;
- `indexVersion` incompatível rejeitado (ex.: um índice v1 pré-A.1);
- `modelId` incompatível rejeitado;
- `dims` incompatíveis rejeitados;
- `payloadLen` mentindo / payload truncado rejeitado;
- contagem de vetores que não bate com `chunks.length` rejeitada;
- **rejeição não produz índice parcial** e não toca o índice local.

**Sync** (`indexSync.test.js`, com `fetch` fake):

- **feature flag desligada → zero `fetch`** e `status: 'disabled'`, e
  `searchMemory` produz exatamente o mesmo resultado de antes da Fase B;
- presigned URL expirada (`403`) → pede outra e refaz, uma vez, sem laço;
- `GET` remoto `404` (primeiro dispositivo) → estado normal, não erro;
- `HEAD` lê `ETag` e os `x-amz-meta-*`;
- `PUT` bem-sucedido atualiza o `ETag` conhecido;
- `If-Match` válido → `200`;
- `If-None-Match: *` na primeira escrita; objeto já existente → conflito;
- **`412` → conflito, e o remoto NÃO é sobrescrito** sem escolha do operador;
- retry seguro: erro de rede repete **com a mesma pré-condição**; `412` nunca é
  retentado automaticamente.

**Privacy** (asserções, não intenção):

- o signer não recebe plaintext: a chamada é `GET`, sem corpo;
- o signer nunca recebe ciphertext — nenhum caminho de código envia o blob para
  `/api/memory-sync`;
- **nenhum segredo R2 aparece no client bundle**: grep no `dist/` por
  `CLOUDFLARE_R2_SECRET`, `CLOUDFLARE_R2_KEY` e pelos valores de teste;
- nenhuma URL pré-assinada é persistida nem logada;
- a passphrase não aparece em `localStorage`, `sessionStorage` nem IndexedDB
  depois de um ciclo completo de sync.

**Aceitação manual (PR 2):** dois navegadores, mesma passphrase, código de sync
transportado à mão, índice atravessa; depois, escrita concorrente nos dois para
provocar `412` e ver o fluxo de conflito.

---

### B18. Implementação — dois PRs

Mesma disciplina das etapas anteriores: branch → PR, `npm run build` +
`npm run lint:design` + `npm test` verdes antes de avançar. **Não commitar
direto na `main`** — foi assim que o arquivo quebrado de B0.1 escapou de
revisão.

**PR 1 — núcleo puro. Sem rede real, sem UI de sync.**

1. Testes primeiro: `indexCrypto.test.js`, `syncCapability.test.js`,
   `indexSerialize.test.js` (as listas de B17).
2. `indexCrypto.js` — derivação (B3) + AES-GCM com AAD (B4).
3. `indexSerialize.js` — envelope versionado e suas validações (B5).
4. `syncCapability.js` — `syncSecret`, `objectId`, código de sync (B2).
5. `deviceId.js`.

Nada neste PR faz `fetch`. Nada neste PR toca componente ou hook.

**PR 2 — rede e UI.**

1. **B0.1**: remover o `api/memory-sync.js` legado, em commit próprio.
2. **CORS do bucket R2** aplicado e verificado (B7) — antes de qualquer teste
   de integração, porque sem isso as falhas são opacas.
3. Spike curto do `If-Match` em URL query-signed (B6), antes de escrever o
   cliente em cima da suposição.
4. `api/memory-sync.js` novo: signer Edge + `aws4fetch`, validação de
   `objectId`/`op`, CORS restrito (B9).
5. `indexSync.js` + `useIndexSync.js` atrás da flag (B11), com `ETag` e `PUT`
   condicional (B6).
6. Wiring no `MemoryPanel` / `StatusStrip` (B14).
7. Testes de integração, incluindo explicitamente: **conflito `412`**,
   **URL expirada**, **flag desligada → zero fetch**, **objeto inexistente**.
8. Playwright contra o **build de produção**, não o dev server — foi o dev
   server que deixou passar o bug de layout do PR #69.
9. Aceitação real com dois navegadores (B17).

---

### B19. Agentes

A Fase B usa a infraestrutura de agentes **que já existe** (`.claude/agents/`).
**Não criar agentes novos** e não alterar os existentes.

| Agente | Papel na Fase B |
| --- | --- |
| `scout_worker` | Diagnóstico: logs de build/Vercel, erro de preflight CORS, resposta do R2, falha de assinatura. Read-only. |
| `ai_ml_worker` | Implementação client-side a partir da spec do Orchestrator: `indexCrypto.js`, `indexSerialize.js`, `syncCapability.js`, `deviceId.js`, `indexSync.js`, `useIndexSync.js`. |
| `architecture-guardian` | Invariantes: `useVaultIndex.js`/`memoryContext.js` intocados, modelo/dims/prefixos E5 preservados, envelope versionado, degradação graciosa. |
| `security-reviewer` | Capability vs. passphrase (B2), CORS do bucket e do signer (B7/B9), segredos R2 fora do bundle (B12), manuseio de presigned URL (B8), threat model (B10). |
| `performance-monitor` | Tamanho de payload, debounce de `push`, custo de operações (B13) e a regressão clássica: sync não pode entrar no caminho de retrieval nem travar a main thread. |

`ui_graph_worker` entra apenas se o wiring de `MemoryPanel`/`StatusStrip`
crescer além de campos e estados — não é o caminho esperado.

---

## Fora de escopo

Explicitamente **fora** da Fase B v4, e permanecem fora:

- Vector DB gerenciado, **ANN**/HNSW, **reranker**.
- **Embeddings na nuvem** — decidido: local, definitivo.
- **Trocar o `Xenova/multilingual-e5-small`** q8 384 dims, ou seus prefixos
  `query:`/`passage:`, pooling e normalização.
- **Mudanças no retrieval**: score híbrido, dedupe por nota, `MAX_HITS`,
  `useVaultIndex.js`.
- **Mudanças no contrato de `memoryContext`** — `selectParts`, o teto de 2000
  caracteres, `buildMemoryContext`/`buildMemoryDetail`.
- **Mudanças em `api/chat.js`** e em `jarvis-prompts.js`.
- **Multiusuário, contas e login.** A autenticação continua capability-based
  (B2); não há e não haverá sessão de servidor nesta arquitetura.
- **Delta sync por chunk** — v1 reescreve o blob inteiro (~8 MB). Otimizar
  depois de uso real, se houver motivo.
- **Quantização dos vetores para `int8`** (384 bytes/chunk em vez de 1.536 —
  4× menor, custo pequeno de recall). Com URLs pré-assinadas o tamanho deixou
  de ser bloqueio, então virou otimização, não requisito.
- **Fine-tuning ou qualquer "aprendizado" de pesos** — memória aqui é
  recuperação + injeção de contexto.
- **Compartilhamento de vault entre pessoas** (fora do escopo de "memória
  pessoal").
- Rotação/revogação de capability, mais de dois dispositivos com identidades
  distintas, e prova de posse do `syncSecret` no signer — registrados em B2.1
  como caminho futuro.

---

## Roadmap

- **Fase A** — ✅ mergeada (PR #68). **Fase A.1** — ✅ mergeada
  (`INDEX_VERSION = 2`, chunk com metadados estruturais, `buildRelevantExcerpt`,
  `memoryTrace`). Reconciliação com o plano original em **B0.0**.
- **Fase B v4** — 🔄 planejada; **este documento é a especificação, não uma
  ordem de execução**. Nada de `src/`, `api/` ou infraestrutura muda até o
  operador abrir o PR 1.
  - ⚠️ `api/memory-sync.js` na `main` (`0344d97`) está quebrado e **não serve
    de base** — removê-lo é a primeira etapa do PR 2 (**B0.1**).
  - **PR 1 · núcleo puro**: TDD de `indexCrypto.js`, `indexSerialize.js`,
    `syncCapability.js`, `deviceId.js`. Sem rede, sem UI.
  - **PR 2 · rede e UI**: remover o legado, aplicar CORS no bucket, signer
    Edge novo, `indexSync.js`, `useIndexSync.js`, wiring no painel/cinta,
    testes de conflito e de flag desligada.
  - **Deploy**: criar bucket R2 privado, **aplicar a política de CORS (B7)**,
    versionamento desligado (B13), configurar env vars (B12), aceitação com
    dois navegadores.

---

## Referências internas

- Fase A: PR #68, `docs/superpowers/plans/2026-08-09-vault-semantic-memory-phase-a.md`
- Fase A.1: `docs/JARVIS_OS_Fase_A1_Retrieval_Refinement.md`
- Invariantes e estado as-built: `CLAUDE.md` § *Vault Semantic Memory (Fase A)*
- Agentes e quem checa qual invariante: `.claude/agents/README.md`
- Criptografia e serialização: `src/lib/indexCrypto.js`, `src/lib/indexSerialize.js` (specs em B3–B5 deste documento)
- Cloud storage: Cloudflare R2 docs (S3 API, CORS Policy, presigned URLs), AWS S3 API reference
