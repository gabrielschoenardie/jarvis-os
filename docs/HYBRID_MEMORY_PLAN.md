# Vault Brain Híbrido — memória semântica local + sync cifrado

## Context

**O que já existe hoje** (tudo mergeado na `main`, até o PR #67):

| Camada | Estado | Onde |
|---|---|---|
| Escrita (Capture) | ✅ pronto (#56) | `chatCapture.js` → `00-Inbox/Capture <data> <hora>.md` |
| Leitura (retrieval) | ⚠️ **só recência** (#57) | `memoryContext.js` → top 5 notas por `mtime` |
| Inspetor | ✅ pronto (#64) | `MemoryPanel.jsx`, aberto pela cinta |

Então a resposta à pergunta "ele fica mais inteligente conforme a gente
conversa?" hoje é: **parcialmente, e por um mecanismo burro**. Cada conversa
vira nota no vault, e as ~5 notas de `mtime` mais recente entram no system
prompt a cada mensagem. Isso é uma janela deslizante de recência, não
memória: uma nota escrita há 3 meses sobre exatamente o assunto da pergunta
**nunca** é recuperada, e uma `lista-compras.md` salva ontem entra numa
conversa técnica só por ser nova. É o problema que o próprio README admite:
_"É recência simples, sem busca semântica — não é uma memória 'inteligente'
ou dirigida pela pergunta atual."_

**O que este plano constrói**: troca a seleção por recência por **busca
semântica sobre o vault inteiro**, calculada 100% no navegador, mais uma
camada de sync cifrado para a memória seguir entre dispositivos.

Decisões travadas com o usuário:
1. **Embeddings locais** — modelo ONNX self-hosted, nenhum texto de nota sai
   da máquina para indexar.
2. **Cloud = sync de índice cifrado** — blob AES-GCM, servidor não lê nada.
3. **Fase A (local) primeiro, Fase B (sync) atrás de flag** — dois PRs.

### Por que embeddings locais encaixam nesta stack sem dependência nova pesada

`onnxruntime-web` **já é dependência** (`package.json`) porque o VAD de voz o
usa, e o `vite.config.js` já copia os `.wasm` dele para a raiz de `/`. O app
já roda sob `Cross-Origin-Embedder-Policy: require-corp` com
`crossOriginIsolated === true`, ou seja, **SharedArrayBuffer disponível** —
que é justamente o que o ORT precisa para o wasm com threads. O precedente de
self-hospedar asset de modelo (`silero_vad_legacy.onnx`) e fontes já está
estabelecido. Nada disso é território novo para o projeto.

---

## Fase A — busca semântica local

### A1. Modelo e runtime

- Modelo: **`Xenova/multilingual-e5-small`** — 384 dimensões, multilíngue
  (PT-BR é primeira classe), variante quantizada q8 ≈ 35 MB.
- Biblioteca: `@huggingface/transformers` (v3).
- ⚠️ **O modelo NÃO pode vir do CDN da HuggingFace**: COEP `require-corp`
  bloqueia terceiros sem CORP, e além disso baixar de terceiro contradiz a
  premissa de privacidade. Self-hospedar em `public/models/`:
  ```js
  env.allowRemoteModels = false;
  env.localModelPath = '/models/';
  env.backends.onnx.wasm.wasmPaths = '/';  // reusa os .wasm já copiados
  ```
- Download do modelo via `scripts/fetch-embedding-model.mjs` rodado no
  `postinstall` (assim o build da Vercel também o busca), com
  `public/models/` no `.gitignore` — não commitar 35 MB.
- **E5 exige prefixos**: `"query: "` ao embutir a pergunta, `"passage: "` ao
  embutir chunks de nota. Errar isso degrada a qualidade silenciosamente.

**Risco nº 1 — dois runtimes ONNX.** `@huggingface/transformers` traz sua
própria versão de `onnxruntime-web`, que pode conflitar com a `^1.26.0` já
pinada pelo VAD (disputa por `wasmPaths`, threads, SharedArrayBuffer).
Mitigação, que também é a decisão certa por outros motivos: **rodar o
embedder dentro de um Web Worker** (`src/workers/embedder.worker.js`). Escopo
de módulo separado elimina a maior parte do conflito e evita travar a UI
durante uma indexação de milhares de notas. Depois de integrar, **testar
explicitamente que a voz/VAD continua funcionando** — é o canário deste risco.

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

Um único blob em IndexedDB sob a chave `jarvis-vault-index`, via o
`idbGet`/`idbSet` que **já existem** em `src/lib/idb.js` — `Float32Array` é
structured-cloneable, então **não precisa mexer no schema nem versionar o
DB**. Formato:

```js
{
  version: 1,
  model: 'multilingual-e5-small',
  dims: 384,
  updatedAt: <epoch>,
  notes: { [path]: { mtime, title, chunkStart, chunkCount } },
  chunks: [{ path, text }],        // texto do trecho, para montar o prompt
  vectors: Float32Array            // packed: chunk i ocupa [i*384, (i+1)*384)
}
```

Vetores **normalizados na indexação** → similaridade de cosseno vira produto
escalar puro. Busca é força bruta: 5.000 chunks × 384 dims ≈ 2M multiply-adds,
poucos milissegundos em JS. **Nenhuma biblioteca de ANN necessária.**

Tamanho: 384 × 4 bytes = 1,5 KB por chunk. Um vault de 3.000 notas ≈ 5.000
chunks ≈ **8 MB**. Confortável para IndexedDB e para o sync da Fase B.

### A4. Indexação incremental (obrigatório, não otimização)

Re-embutir o vault inteiro a cada scan é inviável. `walkVault` em
`useVault.js` **já descarta o corpo** das notas (só guarda metadata +
`targets`), então o indexador relê via `readNote(path)` — exatamente o padrão
que o `useEffect` de `memoryContext` já usa hoje para 5 notas.

Diff por `mtime`, que `buildGraph` já expõe em cada nó:
- nó no grafo e ausente do índice, **ou** `mtime` maior → re-embutir;
- caminho no índice e ausente do grafo → remover.

Rodar em background após `scanId` mudar, cancelável (mesmo padrão do efeito
atual), em lotes com `await new Promise(r => setTimeout(r, 0))` entre eles
para não travar a aba.

### A5. A mudança estrutural — retrieval passa a ser por request

Hoje `memoryContext` é uma **string calculada uma vez por scan**, alheia à
mensagem. Busca semântica precisa da pergunta, então isso precisa virar uma
chamada por mensagem enviada:

```
ANTES:  scan → memoryContext (string fixa)      → toda mensagem manda a mesma coisa
DEPOIS: mensagem → searchMemory(texto) → contexto sob medida daquela pergunta
```

- `useVault.js`: remove o `useEffect` que precomputa `memoryContext`; passa a
  expor `searchMemory(queryText)` (async), `indexStatus`, `indexProgress`.
- `useChat.js`: em `submitCommand`, antes de `callClaude`, faz
  `const memoryContext = await vault.searchMemory(text)`. O parâmetro do hook
  deixa de ser uma string e vira uma função.
- `App.jsx`: passa `searchMemory` em vez de `memoryContext`.

**Contrato preservado de propósito**: `buildMemoryContext(entries)` continua
produzindo exatamente o mesmo formato de texto, com o mesmo teto de 2000
caracteres. Portanto **`jarvis-prompts.js`, `anthropic.js` e `api/chat.js`
não mudam em uma linha** — muda só *quais* notas são escolhidas.

**Efeito colateral bom**: o `MemoryPanel` fica mais correto. O critério que
ele já declara ("a lista bate exatamente com o que foi enviado no último
request") hoje é aproximado; com retrieval por request ele passa a ser
literal. Basta `setMemoryDetail(...)` ao fim de cada `searchMemory`.

### A6. Score híbrido — recência não é jogada fora

```
score = 0.75 × cosseno + 0.25 × exp(−idadeEmDias / 30)
```

Recência continua valendo (uma captura de 10 minutos atrás deve ganhar de uma
nota tangencial de um ano), só deixa de ser o **único** critério. Deduplicar
por nota (melhor chunk de cada nota vence) para não gastar o orçamento de
2000 caracteres com cinco trechos do mesmo arquivo.

### A7. Degradação graciosa (o que impede regressão)

Se o índice não existe, está incompleto, o modelo falhou ao carregar ou o
vault está desconectado → **cai no `selectRecentNotes` que já existe hoje**.
Pior cenário possível = comportamento atual. Nada de tela de erro, nada de
chat quebrado.

### A8. UI

- **Cinta** (`StatusStrip.jsx`): novo item `ÍNDICE` — `1.240/5.100` em ciano
  enquanto indexa (estado ativo real, coerente com a regra da Etapa 4),
  some quando termina. Segue depois dos 4 itens prioritários, para não
  competir no mobile.
- **MemoryPanel**: mostrar o score por nota (ex.: `≈31 tok · 0.82`) e trocar
  o rodapé `"recência pura, sem busca"` — que passa a ser mentira — por
  algo como `"busca semântica + recência"`.

### A9. Arquivos tocados na Fase A

**Novos**: os 6 de A2.
**Modificados**: `src/lib/memoryContext.js` (nova entrada a partir de hits de
busca, mantendo `selectRecentNotes` como fallback e o formato de saída
intacto) · `src/hooks/useVault.js` · `src/hooks/useChat.js` · `src/App.jsx` ·
`src/components/StatusStrip.jsx` · `src/components/MemoryPanel.jsx` ·
`vite.config.js` · `package.json` · `README.md`.

---

## Fase B — sync de índice cifrado (atrás de flag)

Só começa depois da Fase A mergeada e rodando.

- `src/lib/indexCrypto.js`: passphrase → chave por **PBKDF2** (WebCrypto,
  SHA-256, ≥600k iterações, salt aleatório persistido); blob cifrado com
  **AES-GCM** (IV novo a cada escrita). Chave nunca sai do navegador.
- `src/lib/indexSync.js`: `push()` / `pull()`, last-write-wins por
  `updatedAt` + `deviceId`, avisando quando o remoto é mais novo.
- `api/memory-sync.js`: Edge Function, `GET`/`PUT` de um blob opaco no
  **Vercel Blob**. O servidor recebe ciphertext e não tem como ler.
- UI: ação `SINCRONIZAR` no rodapé do `MemoryPanel` (já é a superfície de
  memória) + push automático fortemente debounced.

⚠️ Reescrever 8 MB a cada nota alterada é desperdício. Na v1: sync manual +
automático só depois de ociosidade longa. Delta por chunk fica para depois.

---

## Fora de escopo

- Vector DB gerenciado, ANN/HNSW, reranker.
- Embeddings na nuvem (decidido: local).
- Fine-tuning ou qualquer "aprendizado" de pesos — memória aqui é
  recuperação + injeção de contexto, que é também como ChatGPT e Gemini
  funcionam.
- Mudanças em `jarvis-prompts.js` / `api/chat.js` — o BLOCO 9 já está pronto
  e o contrato de `memoryContext` continua o mesmo.

---

## Entrega deste documento

Primeiro passo, antes de qualquer código: gravar este plano como
**`docs/HYBRID_MEMORY_PLAN.md`** no repo `jarvis-os` e cruzar referência a
partir de `docs/HUD_UPGRADE_ROADMAP.md` — mesmo padrão do
`docs/HUD_AUDIT_PLAN.md`, que foi mergeado sozinho no PR #58 e virou o
documento de governança das 6 etapas. É esse arquivo que fica no VS Code
como a fonte de verdade da implementação.

## Verificação

1. `npm run build` limpo e `npm run lint:design` com as 5 regras passando.
2. **Node isolado** (mesmo padrão usado em `chatCapture.js` e
   `memoryContext.js` nas fases anteriores): `chunker.js` respeita tamanho e
   overlap; `diffIndex` detecta nota nova, alterada e removida; `search`
   devolve o vizinho correto num conjunto sintético de vetores conhecidos.
3. **VAD/voz continua funcionando** — canário do risco de dois runtimes ONNX.
   Testar antes e depois de adicionar o worker.
4. **Playwright**: injetar um índice sintético via `page.evaluate` e conferir
   que `ÍNDICE` aparece na cinta durante a indexação e que o `MemoryPanel`
   lista os hits com score.
5. **Aceitação manual, o teste que importa**: conectar um vault real, esperar
   o índice, e perguntar sobre um assunto que só existe numa nota **antiga**
   — algo que a recência jamais traria. A resposta deve citá-la. Depois
   confirmar que uma `lista-compras.md` recente **não** aparece mais no
   `MemoryPanel` durante uma conversa técnica.
6. **Fallback**: com o índice apagado (limpar IndexedDB), o chat volta ao
   comportamento de recência sem erro visível.
7. Dois PRs, no mesmo fluxo das etapas 1-6: `claude/vault-semantic-memory`
   (Fase A) e `claude/vault-index-sync` (Fase B).