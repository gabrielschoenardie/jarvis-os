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

### B1. Arquitetura — por que Cloudflare R2

| Feature | Vercel Blob (original) | Cloudflare R2 (v2) |
|---------|---|---|
| **Free tier** | ❌ Nenhum | ✅ 10 GB/mês |
| **Egress** | Pago (~$0,08/GB) | ✅ FREE |
| **API** | Proprietária | ✅ S3-compatible |
| **Ideal pra JARVIS** | Locked-in | ✅ Open |

**Cálculo de custo:**
- Índice de vault típico = 8 MB
- Free tier = 10 GB/mês = 1.250 syncs mensais
- Uso real = 2-5 syncs/dia (várias devices)
- Conclusão: **FREE forever pra maioria dos usuários**

Após sair do free tier (100 GB/mês), R2 cobra $0,015/GB — 200× mais barato que egress de outras CDNs e melhor que o resto dos concorrentes.

### B2. Criptografia — WebCrypto, cliente-side

O servidor (R2) **nunca vê dados em claro**. Fluxo:

```
Browser (A): { índice JSON } → gzip → AES-GCM(passphrase, IV aleatório) → ciphertext
                ↓
          R2: armazena blob opaco (ciphertext)
                ↓
Browser (B): GET ciphertext → AES-GCM_decrypt(passphrase) → índice JSON
```

- **Derivação de chave**: PBKDF2 (WebCrypto, SHA-256, 600k iterações, salt aleatório de 16 bytes)
- **Cifra**: AES-GCM (IV novo a cada push, auth tag automático)
- **Salt**: persistido no navegador (`localStorage: jarvis-index-salt`) — mesmo salt, messmos iterations, mesma passphrase = mesma chave
- **Passphrase**: entrada do usuário (não é a do Obsidian Sync, é uma adicional pra Fase B)

**Nota de segurança:** Passphrase fica em RAM e localStorage (que é local-only, não sai do device). Tão segura quanto uma senha do próprio Obsidian.

### B3. Arquivos novos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/indexCrypto.js` | PBKDF2 key derivation, AES-GCM encrypt/decrypt, testes. |
| `src/lib/indexSync.js` | `push()` / `pull()` contra R2, last-write-wins por `updatedAt` + `deviceId`, progress. |
| `src/lib/deviceId.js` | UUID persistido em localStorage, pra resolver conflitos (qual device ganhou a escrita). |
| `api/memory-sync.js` | Node.js Edge Function, proxy pra Cloudflare R2. `GET /api/memory-sync` → index ciphertext, `PUT` → armazena (sem validar conteúdo). |
| `src/hooks/useIndexSync.js` | Coordena pull() no mount, push() debounced a cada scan bem-sucedido + ação manual SINCRONIZAR do MemoryPanel. |

### B4. Formato de sync

Blob armazenado em R2 (opaco ao servidor):

```js
{
  version: 1,
  createdAt: <epoch>,
  updatedAt: <epoch>,
  deviceId: <uuid>,     // qual device fez último push
  ciphertext: Uint8Array,
  salt: Uint8Array,
  iv: Uint8Array,
  authTag: Uint8Array   // AES-GCM authentication
}
```

**Conflitos**: last-write-wins por `updatedAt` + `deviceId`. Quando browser B faz pull e vê que remote é mais novo, oferece ação `CARREGAR DO CLOUD` no MemoryPanel.

### B5. Integração com useVault

- `useVault.js` importa `useIndexSync`
- No mount: `useIndexSync` faz pull() (sem avisar se é pull ou local) e diferencia
- A cada scan bem-sucedido em `useVaultIndex`: `indexSync.push()` agendado (debounce 30s)
- MemoryPanel ganha ação `SINCRONIZAR` (manual) + status badge `cloud` quando conectado

### B6. Env vars (Cloudflare R2)

Em `vercel.json` + `.env.production`:

```
CLOUDFLARE_ACCOUNT_ID=<seu-account-id>
CLOUDFLARE_R2_KEY=<application key com permissão s3>
CLOUDFLARE_R2_SECRET=<application key secret>
CLOUDFLARE_R2_BUCKET=jarvis-memory-index
```

**Como gerar:**
1. Dashboard Cloudflare → R2 → criar bucket `jarvis-memory-index`
2. Settings → API Tokens → Create API Token → S3 Client
3. Copiar Access Key ID (CLOUDFLARE_R2_KEY) + Secret
4. Account ID está no dashboard R2, URL raiz

### B7. Fluxo de UI

**MemoryPanel** (já existe, só adiciona ações):
- Badge `CLOUD` azul enquanto conectado e sincronizando
- Botão `SINCRONIZAR` manual (visível quando `indexStatus === 'ready'` e `indexSyncStatus === 'idle'`)
- Aviso `⚠ INDEX REMOTO MAIS NOVO — CARREGAR?` quando `remoteUpdatedAt > localUpdatedAt`
- Log de último sync (`"sincronizado há 2 minutos"`)

**StatusStrip** (já tem item ÍNDICE):
- Trocar item para duplo: `ÍNDICE` (local) + `CLOUD` (status remoto)
- `CLOUD` fica ciano/`ok` quando conectado, cinzento/muted quando offline

### B8. Degradação e fallback

- **Sem credenciais R2**: desativa sync silenciosamente, continua usando índice local (Fase A standalone)
- **Sem internet**: push fica pendente, pull foi feito no mount (índice continua pronto)
- **R2 offline**: log de erro, continua usando índice local
- **Passphrase errada**: decrypt falha, aviso no MemoryPanel, oferece retry

### B9. Arquivos tocados na Fase B

**Novos**: os 5 de B3.
**Modificados**: `src/hooks/useVault.js` · `src/components/MemoryPanel.jsx` · `src/components/StatusStrip.jsx` · `vercel.json` · `api/chat.js` (nenhuma mudança, só recebe índice sincronizado) · `.env.example` · `package.json` (nenhuma nova dependência — usa WebCrypto nativo).

### B10. Implementação — TDD

Mesma abordagem da Fase A:

1. **Tests primeiro**: `indexCrypto.test.js` (round-trip encrypt/decrypt, passphrase errada falha, salt/IV aleatórios)
2. **Puro Node**: chunker, vectorIndex, deviceId, indexSync — tudo testável sem browser
3. **Integration tests**: Playwright contra build prod, injetar índice remoto via mock R2, conferir UI
4. **Aceitação**: conectar Cloudflare R2 real, sincronizar vault entre 2 browsers

---

## Fora de escopo

- Vector DB gerenciado, ANN/HNSW, reranker.
- Embeddings na nuvem (decidido: local).
- Fine-tuning ou qualquer "aprendizado" de pesos — memória aqui é recuperação + injeção de contexto.
- Mudanças em `jarvis-prompts.js` / `api/chat.js` — o BLOCO 9 já está pronto e o contrato de `memoryContext` continua o mesmo.
- Delta sync por chunk (v1: full blob, ~8MB reescrito). Otimizar após uso real.
- Compartilhamento de vault entre usuários (fora do escopo de "memória pessoal").

---

## Roadmap

- **Fase A**: ✅ Mergeada (PR #68)
- **Fase B**: 🔄 Planejada (este documento, v2 com R2)
  - B-crypto: TDD `indexCrypto.js`
  - B-sync: TDD `indexSync.js`
  - B-integration: Wire em `useVault.js`, `MemoryPanel.jsx`
  - B-deploy: Configurar R2, testar com Vercel

---

## Referências internas

- Fase A: PR #68, `docs/superpowers/plans/2026-08-09-vault-semantic-memory-phase-a.md`
- Criptografia: `src/lib/indexCrypto.js` (specs neste documento)
- Cloud storage: Cloudflare R2 docs, S3 API reference
