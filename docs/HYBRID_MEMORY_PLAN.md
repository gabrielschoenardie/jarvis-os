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

## Fase B — sync de índice cifrado com Cloudflare R2 (FREE)

**Só começa depois da Fase A mergeada e rodando (PR #68 ✅).**

> **Revisão v3.** A v2 deste documento tinha defeitos que já vazaram para o
> código (`api/memory-sync.js` foi commitado direto na `main` em `0344d97`,
> com `Buffer` sob `runtime: 'edge'` e funções de hash/HMAC *placeholder* —
> ver B0). Esta revisão corrige a arquitetura antes de qualquer nova linha.

### B0. Passo zero — o que já está na `main` e está quebrado

`api/memory-sync.js` **já existe** e não funciona. Não é "criar", é
**substituir**. Três defeitos, todos fatais:

1. Declara `export const config = { runtime: 'edge' }` mas usa `Buffer` —
   que não existe no Edge Runtime (isolate V8, não Node). `ReferenceError`
   na primeira chamada.
2. `hashSHA256()` devolve um hex falso e `hmacSHA256()` devolve a string
   literal `'xxxxxxxx'` — os próprios comentários admitem. A assinatura
   AWS SigV4 nunca seria válida; o R2 rejeitaria tudo.
3. Roteia o blob inteiro pelo servidor (ver B1) — o que não cabe.

Nada no `src/` importa esse arquivo, então ele é código morto e o app segue
funcionando. Mas ele **não deve ser usado como base**: começar dele é
herdar os três problemas.

### B1. Arquitetura — R2 com URLs pré-assinadas (não proxy)

R2 continua sendo a escolha certa (free tier 10 GB/mês, egress grátis,
S3-compatible, sem lock-in). O que muda é **como** o navegador chega nele.

**O desenho da v2 não fecha.** Ele mandava os ~8 MB do índice no corpo de um
`PUT /api/memory-sync`, mas funções da Vercel têm teto de corpo de
requisição na ordem de ~4–4,5 MB (Edge e Node). O `PUT` falharia sempre. E
comprimir não resolve: o grosso do índice são vetores `Float32` normalizados,
que comprimem mal — o texto dos chunks encolhe, os vetores quase não.

**Correção — a função só assina, o navegador transfere:**

```
1. Browser  → GET  /api/memory-sync/sign?op=put   (função Vercel, ~1 KB de resposta)
2. Função   → devolve URL R2 pré-assinada, expira em 5 min
3. Browser  → PUT  <url-r2>  (8 MB vão DIRETO pro R2, sem passar pela Vercel)
```

Isso resolve três coisas de uma vez: some o teto de tamanho, some o egress
pela Vercel (o R2 não cobra egress), e as credenciais R2 continuam só no
servidor — o navegador nunca as vê.

**Runtime: Edge.** Com o proxy fora do caminho, a função só faz assinatura —
trabalho pequeno, sem `Buffer`, sem streaming de corpo grande. Edge serve
bem. A regra que isso impõe: **nada de API de Node** nesse arquivo.

**Dependência nova, deliberada.** O B9 da v2 exigia "nenhuma dependência
nova — usa WebCrypto nativo", e foi exatamente essa restrição que produziu o
SigV4 falso. Assinar SigV4 na mão são ~80 linhas de canonicalização
traiçoeira que precisariam dos próprios testes. **`aws4fetch`** (~6 KB, feito
para edge/Workers, usa WebCrypto, suporta `signQuery: true` para
pré-assinatura) elimina essa classe inteira de bug. Vale a dependência.

**Cálculo de custo** (inalterado): índice típico 8 MB · free tier 10 GB/mês
≈ 1.250 syncs/mês · uso real 2–5 syncs/dia → **grátis na prática**. Acima do
free tier, R2 cobra $0,015/GB de armazenamento e nada de egress.

### B2. Criptografia — WebCrypto, cliente-side

O servidor **nunca vê dados em claro**. Fluxo:

```
Browser (A): índice → serializa → AES-GCM(chave, IV aleatório) → ciphertext
                ↓  (PUT direto, URL pré-assinada)
          R2: blob opaco
                ↓  (GET direto, URL pré-assinada)
Browser (B): ciphertext → AES-GCM_decrypt(chave) → índice
```

**Derivação — uma passagem de PBKDF2, dois usos:**

```
salt      = SHA-256("jarvis-os/v1" + passphrase)      // determinístico
material  = PBKDF2(passphrase, salt, 600_000, SHA-256) → 64 bytes
chaveAES  = material[0..31]      // AES-256-GCM
objectId  = hex(material[32..63]) // nome do objeto no R2
```

Por que o `objectId` sai da mesma derivação: **é isso que autentica o
endpoint** (ver B3). Quem não tem a passphrase não consegue nem nomear o
objeto, então não consegue ler nem sobrescrever. Os 32 bytes usados como
nome não enfraquecem a chave AES — são metade distinta do mesmo material, e
o custo de força bruta continua sendo os 600k de iterações.

**Por que o salt é determinístico** (e não aleatório como na v2): um
dispositivo novo só tem a passphrase. Se o salt fosse aleatório e guardado no
`localStorage` do primeiro device, o segundo não teria como derivar a mesma
chave nem descobrir o nome do objeto — o sync nunca bootstrapa. O preço é
perder a proteção contra rainbow tables *entre passphrases diferentes*;
mitigado pelas 600k iterações e por exigir uma passphrase forte. Trade-off
consciente, não descuido.

⚠️ **Correções sobre a v2:**
- **Sem campo `authTag`.** O WebCrypto já devolve a tag **anexada ao
  ciphertext** no AES-GCM — não existe API para obtê-la separada. A v2
  listava `authTag` como campo próprio no B4; isso não é implementável.
- **Passphrase nunca é persistida.** A v2 dizia "fica em RAM e
  localStorage". Guardar a passphrase no `localStorage` deixa o material da
  chave em repouso no navegador e anula boa parte da criptografia. Ela vive
  **só em estado React, na sessão** — o operador redigita a cada sessão, por
  design. (Salt e IV não precisam ser guardados: o salt é derivado, o IV
  viaja junto do blob.)

### B3. Autenticação do endpoint

A v2 expunha `GET`/`PUT` sem autenticação nenhuma e com
`Access-Control-Allow-Origin: '*'`. O ciphertext protege a
**confidencialidade**, mas não a **integridade** nem a **disponibilidade**:
qualquer um que descobrisse a URL poderia sobrescrever o índice, apagá-lo, ou
encher o bucket até estourar o free tier.

Um segredo compartilhado não resolve — o cliente é um navegador, então
qualquer token embutido no bundle é público. A autenticação real vem do
`objectId` derivado da passphrase (B2):

- A função de assinatura recebe o `objectId` e assina uma URL **escopada
  àquele objeto**, com expiração de 5 minutos.
- Sem a passphrase não há `objectId` válido → não há URL → não há acesso.
- A função valida o formato (`^[0-9a-f]{64}$`) antes de assinar, para não
  virar um assinador genérico de caminhos arbitrários no bucket.
- `Access-Control-Allow-Origin` restrito à origem do app, não `*`.

Isso não é autenticação de usuário (o app é pessoal, não tem contas) — é
capability-based: **conhecer o nome do objeto é a credencial**, e o nome só
existe para quem tem a passphrase.

### B4. Formato do objeto no R2

Corpo **binário puro** (`application/octet-stream`), sem JSON envolvendo:

```
[ 12 bytes: IV ][ N bytes: ciphertext + auth tag (AES-GCM) ]
```

Metadados em headers S3 (`x-amz-meta-*`, incluídos na assinatura):

```
x-amz-meta-updated-at: <epoch>
x-amz-meta-device-id:  <uuid>
x-amz-meta-version:    1
```

⚠️ **Correção sobre a v2:** ela especificava `ciphertext: Uint8Array` dentro
de um JSON. `JSON.stringify` de um `Uint8Array` produz
`{"0":12,"1":45,...}` — várias vezes o tamanho original. Para 8 MB isso é
proibitivo. Binário puro não infla nada; base64 (se algum dia for
necessário) inflaria 33%, ainda muito melhor que a forma da v2.

**Checar frescor sem baixar 8 MB:** os metadados em header permitem um
`HEAD` na URL pré-assinada para ler `updated-at` e decidir se vale a pena
puxar o blob. Sem isso, todo check de conflito custaria um download inteiro.

**Conflitos:** last-write-wins por `updatedAt` + `deviceId`. Se o remoto for
mais novo que o local, o `MemoryPanel` oferece `CARREGAR DO CLOUD` — nunca
sobrescreve automaticamente.

### B5. Arquivos novos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/indexCrypto.js` | Derivação (B2) + AES-GCM encrypt/decrypt. Puro, testável em Node. |
| `src/lib/indexSerialize.js` | Índice ↔ bytes. `Float32Array` não é JSON-serializável; converte para `ArrayBuffer` e de volta. Puro. |
| `src/lib/indexSync.js` | `push()` / `pull()` / `peek()` (HEAD) contra as URLs pré-assinadas. |
| `src/lib/deviceId.js` | UUID persistido em `localStorage` (não é segredo — só identifica quem escreveu). |
| `api/memory-sync.js` | **Substitui o arquivo quebrado.** Edge. Valida `objectId`, assina URL R2 com `aws4fetch`, devolve. Não vê bytes do índice. |
| `src/hooks/useIndexSync.js` | Coordena `peek()` no mount, `push()` debounced, e a ação manual do painel. |

### B6. Integração — o invariante que protege a Fase A

**Regra dura: sem as env vars do R2, nenhuma linha da Fase B executa e o
comportamento é idêntico ao de hoje.** A v2 dizia isso em prosa (B8); aqui
vira contrato verificável:

- `useIndexSync` retorna `{ status: 'disabled' }` e não registra efeito
  algum quando `import.meta.env.VITE_MEMORY_SYNC_ENABLED` não está ligado.
- `useVaultIndex` **não muda** — o sync lê e escreve o índice pelas mesmas
  funções de `idb.js` já usadas, sem tocar no caminho de busca.
- Teste dedicado: com a flag desligada, `searchMemory` produz exatamente o
  mesmo resultado de antes da Fase B, e nenhum `fetch` é disparado.

Ligado:
- Mount: `peek()` → se remoto mais novo, oferece carregar (não baixa sozinho).
- Após cada scan bem-sucedido: `push()` com debounce **longo** (≥5 min, não
  os 30 s da v2 — são 8 MB por escrita) ou pela ação manual.

### B7. Fluxo de UI

**MemoryPanel** (superfície de memória, já existe):
- Campo de passphrase (só sessão) quando o sync está ligado e destrancado.
- Ação `SINCRONIZAR` manual.
- Aviso `⚠ ÍNDICE REMOTO MAIS NOVO — CARREGAR?` quando `peek()` detecta.
- Última sincronização em texto (`"sincronizado há 2 minutos"`).
- Erro de passphrase: decrypt falha → aviso + retry, sem apagar nada local.

**StatusStrip** — ⚠️ **correção sobre a v2**, que propunha um item `CLOUD`
ciano permanente enquanto conectado. Isso reintroduz exatamente o que o
PR #67 removeu: brilho gasto para dizer "nada mudou". O item `CLOUD` segue a
mesma regra do `ÍNDICE` — **aparece só enquanto sincroniza**, e some quando
termina. Em repouso, a cinta não ganha item nenhum.

### B8. Env vars

Servidor (Vercel, nunca no bundle):
```
CLOUDFLARE_ACCOUNT_ID=<account id>
CLOUDFLARE_R2_KEY=<S3 access key id>
CLOUDFLARE_R2_SECRET=<S3 secret>
CLOUDFLARE_R2_BUCKET=jarvis-memory-index
```
Cliente (build-time, só liga/desliga a feature):
```
VITE_MEMORY_SYNC_ENABLED=1
```

Como gerar: Dashboard Cloudflare → R2 → criar bucket `jarvis-memory-index`
(privado) → API Tokens → Create API Token → S3 Client → copiar Access Key ID
e Secret. O Account ID está na URL do dashboard R2. Já documentado em
`.env.example`.

### B9. Degradação e fallback

- **Sem env vars / flag desligada**: sync inerte, Fase A intacta (B6).
- **Sem internet**: `push` fica pendente; o índice local segue servindo.
- **R2 fora do ar / URL expirada**: loga, mostra estado no painel, não bloqueia o chat.
- **Passphrase errada**: `decrypt` falha na tag de autenticação → aviso, retry, nada local é destruído.
- **Objeto inexistente (primeiro device)**: `peek()` devolve 404 → estado normal, não é erro.

### B10. Arquivos tocados

**Novos/substituídos**: os 6 de B5.
**Modificados**: `src/hooks/useVault.js` · `src/components/MemoryPanel.jsx` ·
`src/components/StatusStrip.jsx` · `.env.example` · `package.json`
(`aws4fetch`) · `README.md` (nota de privacidade: o índice cifrado passa a
sair da máquina).
**Não tocados**: `jarvis-prompts.js`, `api/chat.js`, `useVaultIndex.js`,
`memoryContext.js` — o contrato de `memoryContext` não muda nesta fase.

### B11. Implementação — TDD, dois PRs

Mesma disciplina das etapas 1–6: branch → PR, `build` + `lint:design` +
`npm test` verdes antes de avançar. **Não commitar direto na `main`** — foi
assim que o arquivo quebrado do B0 escapou de revisão.

**PR 1 — núcleo puro (sem UI, sem rede real):**
1. `indexCrypto.test.js` primeiro: round-trip encrypt/decrypt; passphrase
   errada falha na tag; IV diferente a cada chamada; derivação determinística
   (mesma passphrase → mesmo `objectId` em execuções distintas).
2. `indexSerialize.test.js`: round-trip preserva `Float32Array` bit a bit.
3. `indexCrypto.js`, `indexSerialize.js`, `deviceId.js`.

**PR 2 — rede e UI:**
4. `api/memory-sync.js` substituído (Edge + `aws4fetch`), com validação de
   `objectId` e CORS restrito.
5. `indexSync.js` + `useIndexSync.js` atrás da flag.
6. Wiring no `MemoryPanel`/`StatusStrip`.
7. Playwright contra o build de produção (não o dev server — foi o dev
   server que deixou passar o bug de layout do PR #69).
8. Aceitação real: dois navegadores, mesma passphrase, índice atravessa.

## Fora de escopo

- Vector DB gerenciado, ANN/HNSW, reranker.
- Embeddings na nuvem (decidido: local).
- Fine-tuning ou qualquer "aprendizado" de pesos — memória aqui é recuperação + injeção de contexto.
- Mudanças em `jarvis-prompts.js` / `api/chat.js` — o BLOCO 9 já está pronto e o contrato de `memoryContext` continua o mesmo.
- Delta sync por chunk (v1: full blob, ~8MB reescrito). Otimizar após uso real.
- Quantização dos vetores para `int8` (384 bytes/chunk em vez de 1.536 — 4× menor, custo pequeno de recall). Com URLs pré-assinadas o tamanho deixou de ser bloqueio, então virou otimização, não requisito.
- Contas/multiusuário: a autenticação da Fase B é capability-based (quem tem a passphrase tem acesso), não um sistema de login.
- Compartilhamento de vault entre usuários (fora do escopo de "memória pessoal").

---

## Roadmap

- **Fase A**: ✅ Mergeada (PR #68)
- **Fase B**: 🔄 Planejada (este documento, **v3** — R2 com URLs pré-assinadas)
  - ⚠️ `api/memory-sync.js` na `main` (`0344d97`) está quebrado e **não serve de base** — ver B0
  - PR 1 · núcleo puro: TDD `indexCrypto.js` + `indexSerialize.js` + `deviceId.js`
  - PR 2 · rede e UI: substituir `api/memory-sync.js`, `indexSync.js`, `useIndexSync.js`, wiring no painel/cinta
  - Deploy: criar bucket R2, configurar env vars, aceitação com dois navegadores

---

## Referências internas

- Fase A: PR #68, `docs/superpowers/plans/2026-08-09-vault-semantic-memory-phase-a.md`
- Criptografia: `src/lib/indexCrypto.js` (specs neste documento)
- Cloud storage: Cloudflare R2 docs, S3 API reference
