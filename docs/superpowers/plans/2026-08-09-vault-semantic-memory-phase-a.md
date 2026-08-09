# Vault Semantic Memory — Phase A (local embeddings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JARVIS OS's recency-only vault memory (top-5 most-recently-modified notes, recomputed once per scan) with per-message semantic search over the whole vault, computed 100% in the browser via local ONNX embeddings — closing the gap the README itself admits: *"É recência simples, sem busca semântica."*

**Architecture:** A Web Worker (`embedder.worker.js`) runs `@huggingface/transformers`' `feature-extraction` pipeline against a self-hosted, quantized `multilingual-e5-small` model, isolated from the VAD's own `onnxruntime-web` instance to avoid a dual-runtime conflict. A new `useVaultIndex` hook incrementally indexes the vault (diff by `mtime`) into a single packed `Float32Array` persisted in IndexedDB, and exposes `searchMemory(queryText)`. `useVault.js` swaps its old once-per-scan `memoryContext` string for a `searchMemory(queryText)` function called once per chat message, blending cosine similarity with a recency term, and falling back to the existing recency-only behavior whenever the index isn't ready — so the worst case is exactly today's behavior, never a regression.

**Tech Stack:** `@huggingface/transformers` v3 (new dependency), `onnxruntime-web` (already a dependency via VAD), IndexedDB (`src/lib/idb.js`, already exists), Web Workers, Node's built-in `node:test` runner for pure modules (no test framework exists in this repo yet — this plan introduces the first tests).

## Global Constraints

- Embeddings are 100% local — no note text is ever sent to a third party to index. This is a stated privacy invariant of the vault feature (see README §Conectar/Memória do vault) and must not be violated.
- The model must NOT be fetched from the HuggingFace CDN at runtime: `Cross-Origin-Embedder-Policy: require-corp` (load-bearing for VAD per `CLAUDE.md` — never remove it) blocks any third-party resource without CORP headers. The model is downloaded at build/install time into `public/models/` and served same-origin.
- `multilingual-e5-small` requires text prefixes: `"query: "` for the search query, `"passage: "` for indexed note chunks. Omitting these silently degrades embedding quality — do not skip.
- The embedder MUST run inside a dedicated Web Worker, never on the main thread and never sharing a module scope with the VAD's `onnxruntime-web` usage — two competing ONNX runtimes fighting over `wasmPaths`/threads/`SharedArrayBuffer` is the single biggest risk in this plan (see Task 13's VAD canary check).
- `buildMemoryContext(entries)`'s output text format and the 2000-character total budget are a preserved contract — `src/lib/jarvis-prompts.js` (BLOCO 9) and `api/chat.js` must not change in this plan.
- Graceful degradation is mandatory, not optional: if the index is missing, incomplete, the model fails to load, or the vault is disconnected, the chat must fall back to exactly today's recency-only behavior — never a broken chat, never a visible error screen.
- `public/models/` must never be committed (≈35MB) — it is fetched via a postinstall script and gitignored.
- No automated test framework exists in this project (`CLAUDE.md`: "No lint or test scripts exist"). This plan adds the project's first tests using Node's zero-dependency built-in `node:test` runner — do not introduce Jest/Vitest/etc.

---

### Task 1: `chunkText` — pure note-chunking module

**Files:**
- Create: `src/lib/chunker.js`
- Test: `src/lib/chunker.test.js`

**Interfaces:**
- Produces: `chunkText(rawText: string, opts?: { size?: number, overlap?: number }) => string[]` — strips YAML frontmatter, splits into ~900-char chunks with ~150-char overlap, preferring to break on a paragraph (`\n\n`) or Markdown heading inside the back half of each window. Consumed by Task 6 (`useVaultIndex.js`).

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/chunker.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from './chunker.js';

test('texto vazio retorna lista vazia', () => {
  assert.deepEqual(chunkText(''), []);
});

test('texto menor que o tamanho do chunk vira um único chunk', () => {
  assert.deepEqual(chunkText('nota curta sobre VBV'), ['nota curta sobre VBV']);
});

test('remove frontmatter antes de cortar', () => {
  const raw = '---\ndomain: video\nstatus: seed\n---\n\nConteúdo real da nota.';
  assert.deepEqual(chunkText(raw), ['Conteúdo real da nota.']);
});

test('texto longo sem parágrafos corta em blocos com overlap fixo', () => {
  const text = 'a'.repeat(2000);
  const chunks = chunkText(text, { size: 900, overlap: 150 });
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 900);
  assert.equal(chunks[0].slice(-150), chunks[1].slice(0, 150));
});

test('prefere cortar em fronteira de parágrafo na metade final da janela', () => {
  const partA = 'a'.repeat(500);
  const partB = 'b'.repeat(600);
  const text = `${partA}\n\n${partB}`; // parágrafo cai dentro da janela [450,900)
  const chunks = chunkText(text, { size: 900, overlap: 150 });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], 'a'.repeat(500));
  assert.ok(chunks[1].startsWith('a'.repeat(148)));
  assert.ok(chunks[1].endsWith('b'.repeat(600)));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/lib/chunker.test.js`
Expected: FAIL — `Cannot find module './chunker.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/lib/chunker.js
// Corta o corpo de uma nota (sem frontmatter) em blocos de ~900 caracteres
// com ~150 de overlap para indexação semântica (docs/HYBRID_MEMORY_PLAN.md,
// A2/A4). Prefere cortar em fronteira de parágrafo (\n\n) ou heading (#) na
// metade final de cada janela — corte "duro" só quando nenhuma das duas
// existe. Módulo puro, sem DOM, mesmo padrão testável via Node de
// vault-graph.js.

const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 150;

function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  return end === -1 ? text : text.slice(end + 4);
}

// Procura o melhor ponto de corte dentro de [start, end): olha só a metade
// final da janela, pra garantir que nenhum chunk fique bem menor que
// CHUNK_SIZE/2. Retorna `end` (corte duro) se não achar parágrafo nem heading.
function findBreak(text, start, end) {
  const searchFrom = Math.max(start, end - Math.floor((end - start) / 2));
  const window = text.slice(searchFrom, end);

  const paraIdx = window.lastIndexOf('\n\n');
  if (paraIdx !== -1) return searchFrom + paraIdx + 2;

  let offset = 0;
  let lastHeadingOffset = -1;
  for (const line of window.split('\n')) {
    if (offset > 0 && /^#{1,6}\s/.test(line)) lastHeadingOffset = offset;
    offset += line.length + 1;
  }
  return lastHeadingOffset !== -1 ? searchFrom + lastHeadingOffset : end;
}

export function chunkText(rawText, { size = CHUNK_SIZE, overlap = CHUNK_OVERLAP } = {}) {
  const text = stripFrontmatter(rawText || '').trim();
  if (!text) return [];
  if (text.length <= size) return [text];

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(start + size, text.length);
    if (hardEnd >= text.length) {
      chunks.push(text.slice(start).trim());
      break;
    }
    const breakAt = findBreak(text, start, hardEnd);
    chunks.push(text.slice(start, breakAt).trim());
    start = Math.max(breakAt - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/lib/chunker.test.js`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add src/lib/chunker.js src/lib/chunker.test.js
git commit -m "feat(vault): add chunkText for semantic indexing"
```

---

### Task 2: Vector index — pure diff/pack/search module

**Files:**
- Create: `src/lib/vectorIndex.js`
- Test: `src/lib/vectorIndex.test.js`

**Interfaces:**
- Consumes: nothing (pure). `graph` param has the same shape `buildGraph()` in `src/lib/vault-graph.js` already produces: `{ nodes: [{ path, title, mtime, ghost? }] } `.
- Produces:
  - `diffIndex(graph, index) => { toEmbed: [{path,title,mtime}], toRemove: string[] }` — consumed by Task 6.
  - `packVectors(vectorList: Float32Array[], dims: number) => Float32Array` — consumed by Task 6.
  - `unpackVector(packed: Float32Array, i: number, dims: number) => Float32Array` (view, not copy) — consumed by Task 2 itself (`search`) and Task 6.
  - `search(index: {dims,vectors,chunks}, queryVec: Float32Array, k?: number) => Array<{path,text,score}>` — consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/vectorIndex.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffIndex, packVectors, unpackVector, search } from './vectorIndex.js';

test('diffIndex detecta nota nova', () => {
  const graph = { nodes: [{ path: 'a.md', title: 'A', mtime: 100 }] };
  const index = { notes: {} };
  const { toEmbed, toRemove } = diffIndex(graph, index);
  assert.deepEqual(toEmbed, [{ path: 'a.md', title: 'A', mtime: 100 }]);
  assert.deepEqual(toRemove, []);
});

test('diffIndex detecta nota alterada (mtime mais novo)', () => {
  const graph = { nodes: [{ path: 'a.md', title: 'A', mtime: 200 }] };
  const index = { notes: { 'a.md': { mtime: 100 } } };
  const { toEmbed } = diffIndex(graph, index);
  assert.deepEqual(toEmbed, [{ path: 'a.md', title: 'A', mtime: 200 }]);
});

test('diffIndex não re-embute nota sem mudança', () => {
  const graph = { nodes: [{ path: 'a.md', title: 'A', mtime: 100 }] };
  const index = { notes: { 'a.md': { mtime: 100 } } };
  const { toEmbed } = diffIndex(graph, index);
  assert.deepEqual(toEmbed, []);
});

test('diffIndex ignora nós fantasma e sem path', () => {
  const graph = { nodes: [{ ghost: true, title: 'Ghost', mtime: 0 }] };
  const index = { notes: {} };
  const { toEmbed } = diffIndex(graph, index);
  assert.deepEqual(toEmbed, []);
});

test('diffIndex detecta nota removida', () => {
  const graph = { nodes: [] };
  const index = { notes: { 'sumiu.md': { mtime: 50 } } };
  const { toRemove } = diffIndex(graph, index);
  assert.deepEqual(toRemove, ['sumiu.md']);
});

test('pack/unpack preserva os vetores originais', () => {
  const vectors = [Float32Array.from([1, 0, 0]), Float32Array.from([0, 1, 0])];
  const packed = packVectors(vectors, 3);
  assert.deepEqual([...unpackVector(packed, 0, 3)], [1, 0, 0]);
  assert.deepEqual([...unpackVector(packed, 1, 3)], [0, 1, 0]);
});

test('search devolve o vizinho correto num conjunto sintético de vetores', () => {
  const dims = 3;
  const vectors = packVectors([
    Float32Array.from([1, 0, 0]),
    Float32Array.from([0, 1, 0]),
    Float32Array.from([0.9, 0.1, 0]),
  ], dims);
  const index = {
    dims,
    vectors,
    chunks: [
      { path: 'x.md', text: 'x' },
      { path: 'y.md', text: 'y' },
      { path: 'x2.md', text: 'x2' },
    ],
  };
  const hits = search(index, Float32Array.from([1, 0, 0]), 2);
  assert.equal(hits[0].path, 'x.md');
  assert.equal(hits[1].path, 'x2.md');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/lib/vectorIndex.test.js`
Expected: FAIL — `Cannot find module './vectorIndex.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/lib/vectorIndex.js
// Índice vetorial do vault: diff incremental por mtime, empacotamento de
// vetores num único Float32Array (docs/HYBRID_MEMORY_PLAN.md, A3/A4) e busca
// por produto escalar — vetores já normalizados na indexação (embedder.js),
// então produto escalar == similaridade de cosseno. Módulo puro, sem DOM,
// testável via Node, mesmo padrão de vault-graph.js.

// graph: { nodes: [{ path, title, mtime, ghost? }] } (mesmo shape de
// buildGraph em vault-graph.js). index: { notes: { [path]: { mtime, ... } } }.
// → nota nova ou com mtime mais novo que o indexado entra em toEmbed; nota
// que sumiu do grafo entra em toRemove.
export function diffIndex(graph, index) {
  const toEmbed = [];
  const seen = new Set();
  for (const node of graph.nodes) {
    if (node.ghost || !node.path) continue;
    seen.add(node.path);
    const existing = index.notes[node.path];
    if (!existing || existing.mtime < node.mtime) {
      toEmbed.push({ path: node.path, title: node.title, mtime: node.mtime });
    }
  }
  const toRemove = Object.keys(index.notes).filter(path => !seen.has(path));
  return { toEmbed, toRemove };
}

// vectorList: Float32Array[] (um por chunk, todos com `dims` elementos) → um
// único Float32Array empacotado, chunk i em [i*dims, (i+1)*dims).
export function packVectors(vectorList, dims) {
  const packed = new Float32Array(vectorList.length * dims);
  vectorList.forEach((v, i) => packed.set(v, i * dims));
  return packed;
}

// View (não cópia) do vetor do chunk i dentro do Float32Array empacotado.
export function unpackVector(packed, i, dims) {
  return packed.subarray(i * dims, (i + 1) * dims);
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// Busca por força bruta: produto escalar de queryVec contra cada chunk do
// índice, k mais altos primeiro. Sem ANN — a escala do vault (milhares de
// chunks) roda em poucos milissegundos em JS puro.
export function search(index, queryVec, k = 8) {
  const { dims, vectors, chunks } = index;
  const scored = chunks.map((chunk, i) => ({
    path: chunk.path,
    text: chunk.text,
    score: dot(unpackVector(vectors, i, dims), queryVec),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/lib/vectorIndex.test.js`
Expected: PASS (7/7)

- [ ] **Step 5: Commit**

```bash
git add src/lib/vectorIndex.js src/lib/vectorIndex.test.js
git commit -m "feat(vault): add vectorIndex diff/pack/search"
```

---

### Task 3: `memoryContext.js` — carry an optional score through to the detail panel

**Files:**
- Modify: `src/lib/memoryContext.js` (full file, shown below)
- Test: `src/lib/memoryContext.test.js` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces (signature change): `buildMemoryContext(entries: Array<{title,content,score?}>)` and `buildMemoryDetail(entries)` now accept an optional `score` field per entry and pass it through into `buildMemoryDetail`'s output (`notes[].score`), but `buildMemoryContext`'s returned **text format is byte-identical to before** when `score` is absent — this is the preserved contract Task 8 (`useChat.js`) and `api/chat.js` rely on. Consumed by Task 7 (`useVault.js`) and Task 10 (`MemoryPanel.jsx`).

- [ ] **Step 1: Write the failing test**

```js
// src/lib/memoryContext.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryContext, buildMemoryDetail } from './memoryContext.js';

test('buildMemoryContext produz o mesmo formato de texto com ou sem score', () => {
  const withoutScore = buildMemoryContext([{ title: 'Nota A', content: 'corpo A' }]);
  const withScore = buildMemoryContext([{ title: 'Nota A', content: 'corpo A', score: 0.87 }]);
  assert.equal(withoutScore, withScore);
  assert.equal(withoutScore, 'Notas recentes do vault (mais recentes primeiro):\n— Nota A: corpo A');
});

test('buildMemoryDetail carrega o score quando presente e omite quando ausente', () => {
  const detail = buildMemoryDetail([
    { title: 'Com score', content: 'x', score: 0.42 },
    { title: 'Sem score', content: 'y' },
  ]);
  assert.equal(detail.notes[0].score, 0.42);
  assert.equal(detail.notes[1].score, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/memoryContext.test.js`
Expected: FAIL — `detail.notes[0].score` is `undefined` (current `buildMemoryDetail` doesn't carry `score`)

- [ ] **Step 3: Write the implementation**

```js
// src/lib/memoryContext.js (full file)
// Fase 2 do bloco de memória (ver jarvis-prompts.js, BLOCO 9): monta o texto
// de memoryContext a partir de um conjunto de notas já selecionadas —
// entries: [{ title, content, score? }]. Quem seleciona as entries mudou na
// Fase A (docs/HYBRID_MEMORY_PLAN.md): busca semântica por padrão
// (useVaultIndex.searchMemory), com selectRecentNotes como fallback de
// recência quando o índice não está pronto (ver useVault.js). Este módulo
// não sabe qual dos dois produziu as entries — só formata.

const MAX_NOTES = 5;
const MAX_EXCERPT_CHARS = 400;
const MAX_TOTAL_CHARS = 2000;
const CHARS_PER_TOKEN = 4; // estimativa de bolso pra prosa PT-BR/EN — não é
                            // a tokenização real do modelo, só o suficiente
                            // pro inspetor de memória (Etapa 6) dar uma noção
                            // de custo sem carregar um tokenizer no cliente.

export function selectRecentNotes(graph, limit = MAX_NOTES) {
  if (!graph?.nodes) return [];
  return graph.nodes
    .filter(n => !n.ghost && n.path)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  return end === -1 ? text : text.slice(end + 4);
}

function excerpt(text, max = MAX_EXCERPT_CHARS) {
  const body = stripFrontmatter(text).trim();
  return body.length > max ? body.slice(0, max) + '…' : body;
}

// Monta os pedaços que entram no prompt, aplicando o mesmo teto de
// MAX_TOTAL_CHARS. Compartilhada por buildMemoryContext (o texto que
// efetivamente vai pro modelo) e buildMemoryDetail (o detalhamento do
// inspetor de memória) — garante que os dois nunca divirjam. `score` é
// opcional (presente quando as entries vêm de busca semântica, ausente no
// fallback de recência) e só passa adiante para exibição — nunca influencia
// o corte por caracteres nem o texto do prompt.
function selectParts(entries) {
  const parts = [];
  let used = 0;
  for (const { title, content, score } of entries) {
    const body = excerpt(content);
    const piece = `— ${title}: ${body}`;
    if (used + piece.length > MAX_TOTAL_CHARS) break;
    parts.push({ title, excerpt: body, piece, score });
    used += piece.length;
  }
  return parts;
}

// entries: [{ title, content, score? }] — content já lido do disco via
// readNote() ou vindo de um chunk já indexado.
export function buildMemoryContext(entries) {
  const parts = selectParts(entries);
  if (parts.length === 0) return '';
  return `Notas recentes do vault (mais recentes primeiro):\n${parts.map(p => p.piece).join('\n')}`;
}

// Detalhamento por nota do que está efetivamente no prompt agora — usado só
// pelo MemoryPanel (Etapa 6, só leitura; score exibido desde a Fase A).
// Nenhuma chamada aqui muda o texto produzido por buildMemoryContext.
export function buildMemoryDetail(entries) {
  const parts = selectParts(entries);
  const notes = parts.map(p => ({
    title: p.title,
    excerpt: p.excerpt,
    chars: p.piece.length,
    tokens: Math.ceil(p.piece.length / CHARS_PER_TOKEN),
    score: p.score,
  }));
  const totalChars = notes.reduce((sum, n) => sum + n.chars, 0);
  const totalTokens = notes.reduce((sum, n) => sum + n.tokens, 0);
  return { notes, totalChars, totalTokens };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/memoryContext.test.js`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add src/lib/memoryContext.js src/lib/memoryContext.test.js
git commit -m "feat(vault): thread optional score through memoryContext"
```

---

### Task 4: Dependency, model-fetch script, build wiring

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`
- Modify: `.gitignore`
- Create: `scripts/fetch-embedding-model.mjs`

**Interfaces:**
- Produces: `public/models/Xenova/multilingual-e5-small/{config.json,tokenizer.json,tokenizer_config.json,onnx/model_quantized.onnx}` on disk after `node scripts/fetch-embedding-model.mjs` (or `npm install`) runs. Consumed by Task 5 (`embedder.worker.js`, via `env.localModelPath = '/models/'`).

- [ ] **Step 1: Add the dependency and scripts to `package.json`**

```json
{
  "name": "jarvis-os-brasil",
  "version": "4.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint:design": "node scripts/design-lint.mjs",
    "postinstall": "node scripts/fetch-embedding-model.mjs",
    "test": "node --test src/lib"
  },
  "dependencies": {
    "@huggingface/transformers": "^3.0.0",
    "@ricky0123/vad-react": "^0.0.36",
    "d3-force-3d": "^3.0.6",
    "onnxruntime-web": "^1.26.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "three": "^0.165.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.3.1",
    "vite-plugin-static-copy": "^2.3.2"
  }
}
```

- [ ] **Step 2: Write the model-fetch script**

```js
// scripts/fetch-embedding-model.mjs
#!/usr/bin/env node
// Baixa os arquivos do modelo de embeddings (quantizado q8) do Hugging Face
// Hub para public/models/, rodado no postinstall — assim o build da Vercel
// também busca o modelo antes de `vite build`. public/models/ está no
// .gitignore: ~35 MB não entra no repo. Falha aqui NUNCA quebra o
// install/build — sem modelo, useVaultIndex cai no fallback de recência
// (docs/HYBRID_MEMORY_PLAN.md, A7).

import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const MODEL_ID = 'Xenova/multilingual-e5-small';
const BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const DEST_DIR = path.join('public', 'models', MODEL_ID);

const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function fetchFile(relPath) {
  const dest = path.join(DEST_DIR, relPath);
  if (await exists(dest)) { console.log(`[fetch-embedding-model] já existe: ${relPath}`); return; }
  await mkdir(path.dirname(dest), { recursive: true });
  const url = `${BASE_URL}/${relPath}`;
  console.log(`[fetch-embedding-model] baixando ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`falha ao baixar ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

async function main() {
  for (const f of FILES) {
    await fetchFile(f);
  }
  console.log('[fetch-embedding-model] modelo pronto em', DEST_DIR);
}

main().catch(err => {
  console.error('[fetch-embedding-model] erro:', err.message);
  process.exitCode = 0;
});
```

- [ ] **Step 3: Exclude the new dependency from Vite's dep pre-bundler**

Modify `vite.config.js` — change the `optimizeDeps` block:

```js
  optimizeDeps: {
    include: ['three', 'd3-force-3d'],
    exclude: ['@ricky0123/vad-react', '@ricky0123/vad-web', 'onnxruntime-web', '@huggingface/transformers'],
  },
```

- [ ] **Step 4: Gitignore the downloaded model**

Modify `.gitignore`:

```
.env
node_modules/
dist/
public/models/
```

- [ ] **Step 5: Install and verify the model downloads**

Run: `npm install`
Expected: `postinstall` runs `fetch-embedding-model.mjs`, prints `[fetch-embedding-model] modelo pronto em public/models/Xenova/multilingual-e5-small`, and the four files listed in `FILES` exist on disk (~35MB total, dominated by `onnx/model_quantized.onnx`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.js .gitignore scripts/fetch-embedding-model.mjs
git commit -m "build(vault): fetch local embedding model, exclude from Vite prebundle"
```

---

### Task 5: Embedder Web Worker + main-thread client

**Files:**
- Create: `src/workers/embedder.worker.js`
- Create: `src/lib/embedder.js`

**Interfaces:**
- Consumes: the model files from Task 4 at `/models/Xenova/multilingual-e5-small/`.
- Produces:
  - `warmup(): Promise<void>` — loads the model into the worker; consumed by Task 6.
  - `embedTexts(texts: string[], kind: 'query'|'passage'): Promise<Float32Array[]>` — one 384-dim normalized vector per input text; consumed by Task 6.
  - `setProgressListener(fn: (pct: number) => void): void` — consumed by Task 6 to surface load progress via `indexProgress`.

- [ ] **Step 1: Write the worker**

```js
// src/workers/embedder.worker.js
// Web Worker isolado pra rodar o pipeline de embeddings do
// @huggingface/transformers sem disputar wasmPaths/threads/SharedArrayBuffer
// com o onnxruntime-web já usado pelo VAD no thread principal (ver
// docs/HYBRID_MEMORY_PLAN.md, "Risco nº 1"). env.allowRemoteModels=false +
// localModelPath garante que nada sai pra CDN — bloqueado por COEP
// require-corp de qualquer forma, mas a intenção de privacidade é explícita.

import { pipeline, env } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.localModelPath = '/models/';
env.backends.onnx.wasm.wasmPaths = '/';

const MODEL_ID = 'Xenova/multilingual-e5-small';

let extractorPromise = null;
function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_ID, {
      dtype: 'q8',
      progress_callback: (info) => {
        if (info.status === 'progress') {
          self.postMessage({ type: 'load-progress', progress: info.progress ?? 0 });
        }
      },
    });
  }
  return extractorPromise;
}

// E5 exige prefixo de instrução: "query: " na pergunta, "passage: " nos
// chunks de nota. Omitir isso degrada a qualidade da busca silenciosamente.
async function embed(texts, prefix) {
  const extractor = await getExtractor();
  const prefixed = texts.map(t => `${prefix}: ${t}`);
  const output = await extractor(prefixed, { pooling: 'mean', normalize: true });
  return { data: output.data, dims: output.dims[1] };
}

self.onmessage = async (ev) => {
  const { id, type, texts, kind } = ev.data;
  try {
    if (type === 'warmup') {
      await getExtractor();
      self.postMessage({ id, type: 'ready' });
      return;
    }
    if (type === 'embed') {
      const prefix = kind === 'query' ? 'query' : 'passage';
      const { data, dims } = await embed(texts, prefix);
      self.postMessage({ id, type: 'result', data, dims }, [data.buffer]);
      return;
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err?.message || String(err) });
  }
};
```

- [ ] **Step 2: Write the main-thread client**

```js
// src/lib/embedder.js
// Cliente main-thread do embedder.worker.js: fila de promessas sobre
// postMessage, warm-up e progresso de carregamento do modelo. O worker só é
// criado no primeiro uso (lazy) — conectar o vault sem nunca perguntar nada
// não deve baixar/instanciar o modelo.

let worker = null;
let nextId = 1;
const pending = new Map();
let onProgress = null;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../workers/embedder.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, type } = ev.data;
      if (type === 'load-progress') { onProgress?.(ev.data.progress); return; }
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (type === 'error') entry.reject(new Error(ev.data.message));
      else entry.resolve(ev.data);
    };
    worker.onerror = (err) => {
      for (const { reject } of pending.values()) reject(err);
      pending.clear();
    };
  }
  return worker;
}

function call(message) {
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, ...message });
  });
}

export function setProgressListener(fn) { onProgress = fn; }

export async function warmup() {
  await call({ type: 'warmup' });
}

// texts: string[]; kind: 'query' | 'passage'. Retorna um Float32Array por
// texto, já normalizado pelo pipeline (pooling mean + normalize:true).
export async function embedTexts(texts, kind) {
  if (texts.length === 0) return [];
  const { data, dims } = await call({ type: 'embed', texts, kind });
  const vectors = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(data.subarray(i * dims, (i + 1) * dims));
  }
  return vectors;
}
```

- [ ] **Step 3: Verify the dev server builds and boots with the worker present**

Run: `npm run dev`
Expected: server starts on port 5173 with no console errors related to `embedder.worker.js` or `@huggingface/transformers` (the worker isn't invoked yet — Task 6 wires it up — this step only confirms Vite can resolve/bundle the new files).

- [ ] **Step 4: Commit**

```bash
git add src/workers/embedder.worker.js src/lib/embedder.js
git commit -m "feat(vault): add embedder Web Worker and main-thread client"
```

---

### Task 6: `useVaultIndex` — incremental indexing + search orchestration hook

**Files:**
- Create: `src/hooks/useVaultIndex.js`

**Interfaces:**
- Consumes: `diffIndex`/`packVectors`/`unpackVector`/`search` (Task 2), `chunkText` (Task 1), `embedTexts`/`warmup`/`setProgressListener` (Task 5), `idbGet`/`idbSet` (existing `src/lib/idb.js`).
- Produces: `useVaultIndex(graph, scanId, readNote) => { indexStatus: 'idle'|'loading-model'|'indexing'|'ready'|'unavailable', indexProgress: {done,total}, searchMemory: (queryText: string) => Promise<Array<{title,content,score}>> }`. Consumed by Task 7 (`useVault.js`).

- [ ] **Step 1: Write the hook**

```js
// src/hooks/useVaultIndex.js
// Orquestra o índice semântico local (docs/HYBRID_MEMORY_PLAN.md, Fase A):
// a cada scanId novo, faz diff por mtime contra o índice persistido em
// IndexedDB, relê só as notas mudadas (o corpo já foi descartado do grafo
// em walkVault — mesmo padrão que o antigo efeito de memoryContext em
// useVault.js usava), corta em chunks, embute em lotes, empacota e persiste.
// searchMemory faz busca vetorial + score híbrido (cosseno + recência) e
// dedupe por nota (melhor chunk de cada nota vence).

import { useState, useRef, useCallback, useEffect } from 'react';
import { idbGet, idbSet } from '../lib/idb.js';
import { chunkText } from '../lib/chunker.js';
import { diffIndex, packVectors, unpackVector, search as vectorSearch } from '../lib/vectorIndex.js';
import { embedTexts, warmup, setProgressListener } from '../lib/embedder.js';

const INDEX_KEY = 'jarvis-vault-index';
const MODEL_ID = 'multilingual-e5-small';
const DIMS = 384;
const EMBED_BATCH = 16;
const MAX_HITS = 8;
const COSINE_WEIGHT = 0.75;
const RECENCY_WEIGHT = 0.25;
const RECENCY_HALFLIFE_DAYS = 30;
const DAY_MS = 86400000;

function emptyIndex() {
  return { version: 1, model: MODEL_ID, dims: DIMS, updatedAt: 0, notes: {}, chunks: [], vectors: new Float32Array(0) };
}

export function useVaultIndex(graph, scanId, readNote) {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const indexRef = useRef(null);
  const buildTokenRef = useRef(0);

  useEffect(() => {
    setProgressListener(pct => setProgress(p => ({ ...p, modelPct: pct })));
  }, []);

  // Carrega o índice salvo uma única vez (mount). Índice de versão de
  // modelo/dims diferente é descartado — reindexação completa, não corrompe.
  useEffect(() => {
    (async () => {
      try {
        const saved = await idbGet(INDEX_KEY);
        indexRef.current = saved && saved.dims === DIMS && saved.model === MODEL_ID ? saved : emptyIndex();
      } catch (_) {
        indexRef.current = emptyIndex();
      }
    })();
  }, []);

  useEffect(() => {
    if (!graph) return;
    const token = ++buildTokenRef.current;
    let cancelled = false;

    (async () => {
      while (!indexRef.current) {
        if (cancelled) return;
        await new Promise(r => setTimeout(r, 20));
      }
      const oldIndex = indexRef.current;
      const { toEmbed, toRemove } = diffIndex(graph, oldIndex);

      if (toEmbed.length === 0 && toRemove.length === 0) {
        setStatus('ready');
        return;
      }

      // Reconstrói os arrays finais a partir do que sobrevive (notas sem
      // mudança) + o que será re-embutido — evita cirurgia com splice num
      // Float32Array empacotado, que é fácil de errar.
      const removedOrChanged = new Set([...toRemove, ...toEmbed.map(e => e.path)]);
      const keptChunks = [];
      const keptVectorList = [];
      for (let i = 0; i < oldIndex.chunks.length; i++) {
        const chunk = oldIndex.chunks[i];
        if (removedOrChanged.has(chunk.path)) continue;
        keptChunks.push(chunk);
        keptVectorList.push(unpackVector(oldIndex.vectors, i, oldIndex.dims));
      }
      const keptNotes = {};
      for (const [path, meta] of Object.entries(oldIndex.notes)) {
        if (!removedOrChanged.has(path)) keptNotes[path] = meta;
      }

      if (toEmbed.length === 0) {
        const vectors = packVectors(keptVectorList, DIMS);
        const next = { version: 1, model: MODEL_ID, dims: DIMS, updatedAt: Date.now(), notes: keptNotes, chunks: keptChunks, vectors };
        indexRef.current = next;
        try { await idbSet(INDEX_KEY, next); } catch (_) {}
        setStatus('ready');
        return;
      }

      setStatus('loading-model');
      try {
        await warmup();
      } catch (_) {
        if (cancelled || buildTokenRef.current !== token) return;
        setStatus('unavailable'); // modelo falhou ao carregar — useVault.js cai no fallback de recência
        return;
      }
      if (cancelled || buildTokenRef.current !== token) return;

      setStatus('indexing');
      setProgress({ done: 0, total: toEmbed.length });

      const finalChunks = [...keptChunks];
      const finalVectorList = [...keptVectorList];
      const finalNotes = { ...keptNotes };
      let done = 0;

      for (const entry of toEmbed) {
        if (cancelled || buildTokenRef.current !== token) return;
        let content;
        try {
          ({ content } = await readNote(entry.path));
        } catch (_) {
          done++;
          setProgress({ done, total: toEmbed.length });
          continue; // nota sumiu entre o scan e agora
        }
        const pieces = chunkText(content);
        if (pieces.length > 0) {
          const chunkStart = finalChunks.length;
          for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
            if (cancelled || buildTokenRef.current !== token) return;
            const batch = pieces.slice(i, i + EMBED_BATCH);
            const vectors = await embedTexts(batch, 'passage');
            batch.forEach((text, j) => {
              finalChunks.push({ path: entry.path, text });
              finalVectorList.push(vectors[j]);
            });
          }
          finalNotes[entry.path] = { mtime: entry.mtime, title: entry.title, chunkStart, chunkCount: pieces.length };
        }
        done++;
        setProgress({ done, total: toEmbed.length });
        await new Promise(r => setTimeout(r, 0)); // não trava a aba
      }

      if (cancelled || buildTokenRef.current !== token) return;

      const vectors = packVectors(finalVectorList, DIMS);
      const next = { version: 1, model: MODEL_ID, dims: DIMS, updatedAt: Date.now(), notes: finalNotes, chunks: finalChunks, vectors };
      indexRef.current = next;
      try { await idbSet(INDEX_KEY, next); } catch (_) {}
      setStatus('ready');
    })();

    return () => { cancelled = true; };
  }, [scanId, graph, readNote]);

  // score híbrido (docs/HYBRID_MEMORY_PLAN.md, A6): cosseno domina, recência
  // desempata a favor de captures recentes sobre notas tangenciais antigas.
  // Dedupe por nota: só o melhor chunk de cada nota sobrevive, pra não gastar
  // o orçamento de 2000 caracteres com 5 trechos do mesmo arquivo.
  const searchMemory = useCallback(async (queryText) => {
    const index = indexRef.current;
    if (!index || index.chunks.length === 0) return [];
    const [queryVec] = await embedTexts([queryText], 'query');
    const hits = vectorSearch(index, queryVec, MAX_HITS * 3);
    const now = Date.now();
    const byNote = new Map();
    for (const hit of hits) {
      const note = index.notes[hit.path];
      const ageDays = note ? (now - note.mtime) / DAY_MS : 999;
      const recency = Math.exp(-ageDays / RECENCY_HALFLIFE_DAYS);
      const score = COSINE_WEIGHT * hit.score + RECENCY_WEIGHT * recency;
      const existing = byNote.get(hit.path);
      if (!existing || score > existing.score) {
        byNote.set(hit.path, { title: note?.title || hit.path, content: hit.text, score });
      }
    }
    return [...byNote.values()].sort((a, b) => b.score - a.score).slice(0, MAX_HITS);
  }, []);

  return { indexStatus: status, indexProgress: progress, searchMemory };
}
```

- [ ] **Step 2: Verify the app still builds with the hook present but unwired**

Run: `npm run build`
Expected: clean build, no import errors (the hook isn't called from `useVault.js` yet — that's Task 7).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useVaultIndex.js
git commit -m "feat(vault): add useVaultIndex incremental indexing hook"
```

---

### Task 7: Wire `useVaultIndex` into `useVault.js`, replace precomputed `memoryContext`

**Files:**
- Modify: `src/hooks/useVault.js` (full file, shown below)

**Interfaces:**
- Consumes: `useVaultIndex` (Task 6), `selectRecentNotes`/`buildMemoryContext`/`buildMemoryDetail` (Task 3).
- Produces (return-shape change): removes `memoryContext` from the returned object, adds `searchMemory: (queryText: string) => Promise<string>` and `indexStatus`, `indexProgress`. `memoryDetail` gains a `mode: 'semantic'|'recency'` field. Consumed by Task 8 (`useChat.js`), Task 9 (`App.jsx`), Task 10/11 (`StatusStrip.jsx`/`MemoryPanel.jsx`).

- [ ] **Step 1: Write the full modified file**

```js
// src/hooks/useVault.js
import { useState, useEffect, useRef, useCallback } from 'react';
import { idbGet, idbSet } from '../lib/idb.js';
import { parseWikilinks, buildGraph } from '../lib/vault-graph.js';
import { selectRecentNotes, buildMemoryContext, buildMemoryDetail } from '../lib/memoryContext.js';
import { useVaultIndex } from './useVaultIndex.js';

// Conexão com o vault Obsidian local via File System Access API (Chromium).
// 100% client-side: as notas nunca saem do navegador — só o conteúdo de UMA
// nota, quando o operador clica explicitamente em "ANALISAR COM JARVIS", ou
// automaticamente como memória de curto prazo (ver searchMemory abaixo,
// nunca sai da máquina pra indexar — só o texto entra no prompt do Claude).
// O handle da pasta persiste em IndexedDB; nas visitas seguintes basta
// re-conceder a permissão com um clique (requestPermission exige gesto).

const HANDLE_KEY = 'jarvis-vault-handle';
const MAX_FILES = 4000;
const MAX_PARSE_BYTES = 2 * 1024 * 1024;
const YIELD_EVERY = 25;

function extractDomain(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = text.slice(3, end);
  const m = fm.match(/^domain:\s*(.+)$/m);
  return m ? m[1].trim() : null;
}

async function walkVault(dirHandle, onProgress) {
  const files = [];
  async function walk(handle, prefix) {
    for await (const entry of handle.values()) {
      if (files.length >= MAX_FILES) return;
      if (entry.kind === 'directory') {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        await walk(entry, prefix + entry.name + '/');
      } else if (entry.name.toLowerCase().endsWith('.md')) {
        const file = await entry.getFile();
        let targets = [];
        let words;
        let domain;
        if (file.size > MAX_PARSE_BYTES) {
          words = Math.round(file.size / 6); // estimativa — pula o parse
          domain = null;
        } else {
          const text = await file.text();
          targets = parseWikilinks(text);
          words = text.split(/\s+/).filter(Boolean).length;
          domain = extractDomain(text);
          // corpo descartado aqui — só metadata + targets ficam em memória
        }
        files.push({ path: prefix + entry.name, name: entry.name, mtime: file.lastModified, size: file.size, targets, words, domain });
        if (files.length % YIELD_EVERY === 0) {
          onProgress?.(files.length);
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }
  }
  await walk(dirHandle, '');
  return { files, truncated: files.length >= MAX_FILES };
}

export function useVault() {
  const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const [status, setStatus] = useState(supported ? 'idle' : 'unsupported');
  const [graph, setGraph] = useState(null);
  const [progress, setProgress] = useState({ scanned: 0 });
  const [truncatedScan, setTruncatedScan] = useState(false);
  const [error, setError] = useState(null);
  const [scanId, setScanId] = useState(0);
  // Permissão de escrita concedida — habilita a Captura automática de
  // conversas em 00-Inbox/ (ver src/lib/chatCapture.js). 'read' continua
  // sendo suficiente pro scan/grafo; 'readwrite' é só o que a Captura exige.
  const [canWrite, setCanWrite] = useState(false);
  // Detalhamento por nota do que entrou no último prompt (título, trecho,
  // tokens estimados, score quando veio de busca semântica) — alimenta o
  // MemoryPanel (Etapa 6). `mode` diz se veio de busca semântica ou do
  // fallback de recência (ver searchMemory abaixo).
  const [memoryDetail, setMemoryDetail] = useState({ notes: [], totalChars: 0, totalTokens: 0, mode: 'recency' });

  const handleRef = useRef(null);
  const scanTokenRef = useRef(0);
  // Cache de posições do layout 3D — a cena grava aqui no unmount para que
  // voltar ao modo VAULT não re-rode a simulação inteira.
  const layoutCacheRef = useRef({ scanId: -1, positions: null });

  const scanVault = useCallback(async (dirHandle) => {
    const token = ++scanTokenRef.current;
    setStatus('scanning');
    setProgress({ scanned: 0 });
    setError(null);
    try {
      const { files, truncated } = await walkVault(dirHandle, n => {
        if (scanTokenRef.current === token) setProgress({ scanned: n });
      });
      if (scanTokenRef.current !== token) return; // scan mais novo em andamento
      setGraph(buildGraph(files));
      setTruncatedScan(truncated);
      setScanId(id => id + 1);
      setStatus('ready');
    } catch (err) {
      if (scanTokenRef.current !== token) return;
      // NotFoundError: o handle salvo aponta pra uma pasta que sumiu do caminho
      // (movida, renomeada, excluída ou num drive/nuvem desconectado). Re-varrer
      // o mesmo handle só repete o erro — a saída é escolher a pasta de novo.
      const notFound = err?.name === 'NotFoundError';
      setError(notFound
        ? 'pasta do vault não encontrada — pode ter sido movida, renomeada, excluída ou está num drive/nuvem desconectado. Use "CONECTAR OUTRO VAULT" para escolher a pasta de novo.'
        : (err.message || 'falha ao varrer o vault'));
      setStatus('error');
    }
  }, []);

  // Mount: restaura o handle salvo e re-escaneia se a permissão persiste
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      try {
        const handle = await idbGet(HANDLE_KEY);
        if (cancelled || !handle) return;
        handleRef.current = handle;
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (cancelled) return;
        if (perm === 'granted') { setCanWrite(true); scanVault(handle); }
        else setStatus('permission');
      } catch (_) { /* idb indisponível → segue em 'idle' */ }
    })();
    return () => { cancelled = true; };
  }, [supported, scanVault]);

  const connectVault = useCallback(async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      handleRef.current = handle;
      try { await idbSet(HANDLE_KEY, handle); } catch (_) {}
      setCanWrite(true);
      await scanVault(handle);
    } catch (err) {
      if (err.name === 'AbortError') return; // usuário cancelou o picker
      setCanWrite(false);
      setError(err.message);
      setStatus('error');
    }
  }, [scanVault]);

  const reconnectVault = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return connectVault();
    try {
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') { setCanWrite(true); await scanVault(handle); }
      else { setCanWrite(false); setStatus('permission'); }
    } catch (_) {
      setCanWrite(false);
      setStatus('permission');
    }
  }, [connectVault, scanVault]);

  const rescanVault = useCallback(() => {
    if (handleRef.current) scanVault(handleRef.current);
  }, [scanVault]);

  // Releitura fresca de uma nota (o arquivo pode ter mudado desde o scan)
  const readNote = useCallback(async (path) => {
    const handle = handleRef.current;
    if (!handle) throw new Error('vault desconectado');
    const parts = path.split('/');
    let dir = handle;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]);
    }
    const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
    return { content: await file.text(), mtime: file.lastModified };
  }, []);

  // Fase A (docs/HYBRID_MEMORY_PLAN.md): índice semântico local, mantido
  // incrementalmente a cada scan bem-sucedido. indexStatus/indexProgress
  // alimentam o item ÍNDICE da cinta (StatusStrip); a busca em si só roda
  // por mensagem, via searchMemory abaixo.
  const { indexStatus, indexProgress, searchMemory: semanticSearch } = useVaultIndex(graph, scanId, readNote);

  // Substitui o antigo useEffect que precomputava memoryContext uma vez por
  // scan (Fase 2): agora é chamado por useChat.js antes de cada mensagem,
  // pra a busca ser sobre o texto real da pergunta (A5). Sempre grava
  // memoryDetail como efeito colateral, pro MemoryPanel refletir exatamente
  // o que foi pro prompt. Fallback de recência (A7) quando o índice não está
  // pronto (idle/loading-model/indexing/unavailable) ou não devolve hits —
  // pior caso possível é o comportamento de antes, nunca um chat quebrado.
  const searchMemory = useCallback(async (queryText) => {
    if (!graph) return '';
    let entries = [];
    let mode = 'recency';

    if (indexStatus === 'ready') {
      try {
        const hits = await semanticSearch(queryText);
        if (hits.length > 0) { entries = hits; mode = 'semantic'; }
      } catch (_) { /* busca falhou — cai no fallback de recência abaixo */ }
    }

    if (entries.length === 0) {
      const candidates = selectRecentNotes(graph);
      for (const node of candidates) {
        try {
          const { content } = await readNote(node.path);
          entries.push({ title: node.title, content });
        } catch (_) { /* nota sumiu entre o scan e agora — ignora */ }
      }
    }

    setMemoryDetail({ ...buildMemoryDetail(entries), mode });
    return buildMemoryContext(entries);
  }, [graph, indexStatus, semanticSearch, readNote]);

  // Grava (cria ou sobrescreve) uma nota de Captura em 00-Inbox/ — usado pela
  // Captura automática de conversas (src/lib/chatCapture.js). Exige que o
  // handle tenha sido concedido em modo 'readwrite'.
  const writeCaptureNote = useCallback(async (filename, content) => {
    const handle = handleRef.current;
    if (!handle) throw new Error('vault desconectado');
    const inboxDir = await handle.getDirectoryHandle('00-Inbox');
    const fileHandle = await inboxDir.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }, []);

  return {
    status, graph, progress, truncatedScan, error, scanId, canWrite,
    searchMemory, memoryDetail, indexStatus, indexProgress,
    connectVault, reconnectVault, rescanVault, readNote, writeCaptureNote,
    layoutCacheRef,
  };
}
```

- [ ] **Step 2: Verify the build still succeeds**

Run: `npm run build`
Expected: clean build. `useVault.js` no longer exports `memoryContext` — this will break `App.jsx`/`useChat.js` call sites until Tasks 8–9 land; if executing tasks out of order, expect a runtime error until those land (not a build error, since JS doesn't type-check destructured-but-missing properties).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useVault.js
git commit -m "feat(vault): wire useVaultIndex into useVault, replace precomputed memoryContext with searchMemory"
```

---

### Task 8: `useChat.js` — call `searchMemory` per message instead of a static prop

**Files:**
- Modify: `src/hooks/useChat.js:14` (function signature)
- Modify: `src/hooks/useChat.js:274-279` (retry loop, computing memory once before it)

**Interfaces:**
- Consumes: `searchMemory` function from Task 7.
- Produces: no external signature change — `callClaude` still receives a `memoryContext` string, computed fresh per `submitCommand` call instead of passed in as a static prop.

- [ ] **Step 1: Change the hook signature**

In `src/hooks/useChat.js`, line 14:

```js
// Before
export function useChat({ speakChunks, startTimer, stopTimer, apiHistoryRef, onPersistTurns, memoryContext }) {
```

```js
// After
export function useChat({ speakChunks, startTimer, stopTimer, apiHistoryRef, onPersistTurns, searchMemory }) {
```

- [ ] **Step 2: Compute memory once per submitted message, before the retry loop**

In `src/hooks/useChat.js`, immediately after the `newApiHistory`/`apiHistoryRef` block (around line 208, right before the `// Coalesce dos deltas SSE` comment):

```js
    const newApiHistory = [...currentApiHistory, { role: 'user', content: userContent }];
    setApiHistory(newApiHistory);
    if (apiHistoryRef) apiHistoryRef.current = newApiHistory;

    // Fase A (docs/HYBRID_MEMORY_PLAN.md): busca de memória por mensagem,
    // sobre o texto real digitado — não mais uma string fixa por scan.
    // Calculada uma única vez por envio, fora do loop de retry de 429
    // abaixo (não faz sentido buscar de novo a cada tentativa).
    const memoryContext = searchMemory ? await searchMemory(cmd) : '';
```

Then update the `callClaude` call (around line 278) to use this local `memoryContext` instead of the old prop — the call site itself is unchanged text (`memoryContext` already appears there), since it now resolves to the local `const` instead of the destructured prop:

```js
          ({ text: responseText, jarvis, tokenUsage } = await callClaude(newApiHistory, { onChunk, onAction, onToolStatus, memoryContext }));
```

- [ ] **Step 3: Verify the build succeeds**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useChat.js
git commit -m "feat(vault): call searchMemory per message instead of static memoryContext prop"
```

---

### Task 9: `App.jsx` — wire `searchMemory`/`indexStatus`/`indexProgress` through

**Files:**
- Modify: `src/App.jsx:107-108`
- Modify: `src/App.jsx:411-420`

**Interfaces:**
- Consumes: `vault.searchMemory`, `vault.indexStatus`, `vault.indexProgress` from Task 7; `StatusStrip`'s new props from Task 10.

- [ ] **Step 1: Update the `useChat` call**

In `src/App.jsx`:

```js
// Before (lines 102-109)
  const chat = useChat({
    startTimer,
    stopTimer,
    apiHistoryRef,
    speakChunks: speech.speakChunks,
    onPersistTurns: vault.canWrite ? vault.writeCaptureNote : null,
    memoryContext: vault.memoryContext,
  });
```

```js
// After
  const chat = useChat({
    startTimer,
    stopTimer,
    apiHistoryRef,
    speakChunks: speech.speakChunks,
    onPersistTurns: vault.canWrite ? vault.writeCaptureNote : null,
    searchMemory: vault.searchMemory,
  });
```

- [ ] **Step 2: Pass index status/progress to `StatusStrip`**

In `src/App.jsx`:

```js
// Before (lines 411-420)
      <StatusStrip
        vault={vault}
        memoryNoteCount={memoryNoteCount}
        onOpenMemory={() => setMemoryPanelOpen(o => !o)}
        focusMode={focusMode}
        speech={speech}
        contextPct={contextPct}
        subscribeLatency={subscribeLatency}
        getLatency={getLatency}
      />
```

```js
// After
      <StatusStrip
        vault={vault}
        memoryNoteCount={memoryNoteCount}
        onOpenMemory={() => setMemoryPanelOpen(o => !o)}
        focusMode={focusMode}
        speech={speech}
        contextPct={contextPct}
        subscribeLatency={subscribeLatency}
        getLatency={getLatency}
        indexStatus={vault.indexStatus}
        indexProgress={vault.indexProgress}
      />
```

- [ ] **Step 3: Verify the build succeeds**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(vault): wire searchMemory and index status/progress through App"
```

---

### Task 10: `StatusStrip.jsx` — `ÍNDICE` item while indexing

**Files:**
- Modify: `src/components/StatusStrip.jsx:44-75` (full component body shown below)

**Interfaces:**
- Consumes: `indexStatus`, `indexProgress` props from Task 9.

- [ ] **Step 1: Add the prop and the item**

```jsx
// src/components/StatusStrip.jsx (full file)
import { useState, useEffect } from 'react';
import { C, MODEL, mono } from '../lib/constants.js';

// Cinta de estado (Etapa 4) — faixa persistente de 28px sob o header, só com
// sinal real e persistente: vault, memória em contexto, voz, contexto,
// modelo, latência. Resolve de uma vez: mata a fila de banners persistentes
// (memória e foco viram itens daqui, não notificação permanente), dá aos
// rails permissão de serem cenário nas telas largas, e é o único instrumento
// que sobrevive abaixo de 900px — vive fora de `.jv-rail-left`.
//
// Regra de leitura: em repouso a cinta inteira é quiet. Um item só ganha
// ciano quando reflete um estado ativo agora (vault conectado/escaneando,
// voz ouvindo/falando, foco em curso, índice semântico construindo).
// Contadores puros (memória, contexto, latência) ficam sempre quiet — são
// números, não um liga/desliga.

// onClick é opcional — só o item MEMÓRIA (Etapa 6) o usa hoje, pra abrir o
// inspetor. Os demais continuam puramente informativos.
function Item({ label, value, active, className, onClick }) {
  const interactive = typeof onClick === 'function';
  return (
    <span
      className={className}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } }) : undefined}
      style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, whiteSpace: 'nowrap', cursor: interactive ? 'pointer' : 'default' }}
    >
      <span style={{ color: active ? C.accent : C.muted }}>{label}</span>
      <span style={{ ...mono, color: active ? C.accent : C.quiet, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </span>
  );
}

// Isolado como leaf subscriber (mesmo padrão de LatencyReadout em App.jsx) —
// o tick de 100ms durante uma requisição não pode re-renderizar a cinta
// inteira, muito menos o App.
function StripLatency({ subscribe, getInitial }) {
  const [ms, setMs] = useState(() => getInitial());
  useEffect(() => subscribe(setMs), [subscribe]);
  return <Item label="LAT" value={`${Math.round(ms)}ms`} />;
}

export function StatusStrip({ vault, memoryNoteCount, onOpenMemory, focusMode, speech, contextPct, subscribeLatency, getLatency, indexStatus, indexProgress }) {
  const noteCount = vault.graph ? vault.graph.nodes.filter(n => !n.ghost).length : 0;
  const vaultActive = vault.status === 'ready' || vault.status === 'scanning';
  const vaultValue = vault.status === 'ready' ? `${noteCount.toLocaleString('pt-BR')} notas`
    : vault.status === 'scanning' ? 'varrendo…'
    : 'desconectado';

  const voiceName = speech.elVoices?.find(v => v.voice_id === speech.selectedVoiceId)?.name;
  // Falando já tem o banner (App.jsx) com TRANSMITINDO + SILENCIAR — mais
  // proeminente e com ação real, diferente da cinta que é só leitura.
  // Contando o header (VoiceIndicator) e o Presence Core, virar ciano aqui
  // também é o 4º sinal repetindo o mesmo fato — achado P1 · redundância da
  // auditoria de HUD. A cinta acende só pra ouvindo, que não tem banner.
  const voiceActive = speech.listening;
  const voiceValue = voiceName ? `EL · ${voiceName}` : (speech.voiceOut ? 'ativa' : 'muda');

  // Fase A: ÍNDICE só aparece enquanto constrói (carregando modelo ou
  // embutindo notas) — some quando pronto, mesma regra de sinal-ativo-agora
  // que os demais itens. Não aparece se nunca indexou (idle) nem quando
  // indisponível (unavailable) — nesses casos o fallback de recência já
  // cobre silenciosamente, sem precisar de sinal na cinta.
  const indexing = indexStatus === 'loading-model' || indexStatus === 'indexing';
  const indexValue = indexStatus === 'loading-model' ? 'carregando modelo…' : `${indexProgress.done}/${indexProgress.total}`;

  // Ordem prioriza os 4 itens que precisam sobreviver a 375px sem depender de
  // scroll horizontal (vault, contexto, modelo, latência — o critério de
  // pronto da Etapa 4); foco/memória/índice/voz vêm depois, ainda alcançáveis
  // via overflow-x na cinta, mas não competem pelos primeiros pixels visíveis.
  return (
    <div className="jv-strip" style={{ borderBottom: `1px solid ${C.line}`, background: 'rgba(5,10,20,0.92)', padding: '0 28px', height: 28, display: 'flex', alignItems: 'center', gap: 20, fontSize: 10, letterSpacing: '0.1em', overflowX: 'auto' }}>
      <Item label="VAULT" value={vaultValue} active={vaultActive} />
      <Item label="CTX" value={`${contextPct}%`} />
      <Item label="MODELO" value={MODEL.label} />
      <StripLatency subscribe={subscribeLatency} getInitial={getLatency} />
      {focusMode && <Item label="◆ FOCO" value={focusMode.toUpperCase()} active />}
      {memoryNoteCount > 0 && <Item label="MEMÓRIA" value={memoryNoteCount} onClick={onOpenMemory} />}
      {indexing && <Item label="ÍNDICE" value={indexValue} active />}
      {speech.speechSupported && <Item label="VOZ" value={voiceValue} active={voiceActive} className="jv-hide-sm" />}
    </div>
  );
}
```

- [ ] **Step 2: Verify the build succeeds**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/components/StatusStrip.jsx
git commit -m "feat(vault): show ÍNDICE item on the status strip while indexing"
```

---

### Task 11: `MemoryPanel.jsx` — show per-note score, mode-aware footer

**Files:**
- Modify: `src/components/MemoryPanel.jsx` (full file shown below)

**Interfaces:**
- Consumes: `detail.notes[].score` (optional), `detail.mode` from Task 7/3.

- [ ] **Step 1: Write the full modified file**

```jsx
// src/components/MemoryPanel.jsx
import { useEffect, useRef } from 'react';
import { C, mono, z } from '../lib/constants.js';
import { HoloPanel } from './hud/index.js';

// Inspetor de memória (Etapa 6, só leitura) — a cinta mostra "MEMÓRIA: N"
// desde a Etapa 4. Isto expõe exatamente as notas que entraram no último
// prompt, o custo estimado em tokens, e — desde a Fase A
// (docs/HYBRID_MEMORY_PLAN.md) — o score de relevância quando a origem foi
// busca semântica (`detail.mode === 'semantic'`; ausente/undefined no
// fallback de recência). `detail` vem de vault.memoryDetail
// (src/lib/memoryContext.js:buildMemoryDetail), calculado pela mesma função
// que monta o texto efetivamente enviado — a lista aqui nunca diverge do que
// foi pro modelo. Nada aqui muda o que é enviado; fixar/excluir uma nota do
// contexto é um passo futuro, não este.
export function MemoryPanel({ detail, onClose }) {
  const closeBtnRef = useRef(null);
  const restoreFocusRef = useRef(null);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    restoreFocusRef.current = document.activeElement;
    closeBtnRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      const el = restoreFocusRef.current;
      if (el && typeof el.focus === 'function') el.focus();
    };
  }, [onClose]);

  const { notes, totalChars, totalTokens, mode } = detail;
  const footerLabel = mode === 'semantic' ? 'busca semântica + recência' : 'recência pura, sem busca';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: z.overlay, pointerEvents: 'none' }}>
      {/* Clique fora fecha — não é modal: o HUD atrás segue interativo. */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }} />

      <div className="jv-fade" style={{ position: 'absolute', top: 88, left: 28, pointerEvents: 'auto' }}>
        <HoloPanel style={{ width: 'min(420px, 88vw)', maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 0 40px rgba(0,212,255,0.12)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 10, color: C.accent, letterSpacing: '0.22em', flex: 1 }}>◉ MEMÓRIA · NO PROMPT AGORA</span>
            <button
              ref={closeBtnRef}
              onClick={onClose}
              aria-label="Fechar"
              style={{ background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accent, fontSize: 11, lineHeight: 1, padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit' }}
            >✕</button>
          </div>

          {notes.length === 0 ? (
            <div style={{ fontSize: 11, color: C.quiet, letterSpacing: '0.06em' }}>nenhuma nota recente do vault entrou no contexto.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {notes.map(n => (
                <div key={n.title} style={{ borderLeft: `2px solid ${C.line}`, paddingLeft: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11, color: C.text }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</span>
                    <span style={{ ...mono, color: C.quiet, whiteSpace: 'nowrap' }}>
                      ≈{n.tokens} tok{n.score != null ? ` · ${n.score.toFixed(2)}` : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>
                    {n.excerpt.length > 140 ? n.excerpt.slice(0, 140) + '…' : n.excerpt}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted, letterSpacing: '0.08em' }}>
            <span>{notes.length} nota{notes.length === 1 ? '' : 's'} · {footerLabel}</span>
            <span style={{ ...mono, color: C.quiet }}>≈{totalTokens} tok · {totalChars}/2000 car.</span>
          </div>
        </HoloPanel>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the build succeeds**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/components/MemoryPanel.jsx
git commit -m "feat(vault): show per-note relevance score and search mode in MemoryPanel"
```

---

### Task 12: `README.md` — correct the "recência pura, sem busca" claim

**Files:**
- Modify: `README.md:58`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update the memory section**

```markdown
<!-- Before -->
- **Memória do vault**: a cada scan, o app seleciona as ~5 notas com data de modificação mais recente (sem distinguir pasta — capturas de conversa em `00-Inbox/` costumam aparecer aqui logo após um papo) e injeta um resumo curto delas no prompt do sistema, pra o Jarvis ter noção do que você andou escrevendo/discutindo. É recência simples, sem busca semântica — não é uma memória "inteligente" ou dirigida pela pergunta atual.
```

```markdown
<!-- After -->
- **Memória do vault**: a cada mensagem, o app busca no vault inteiro por relevância semântica à pergunta atual (embeddings ONNX rodando 100% no navegador, `Xenova/multilingual-e5-small` — nenhum texto de nota sai da máquina para indexar) e injeta um resumo curto das notas mais relevantes no prompt do sistema, combinando similaridade de significado com recência (uma captura de minutos atrás ainda pesa mais que uma nota tangencial antiga). Enquanto o índice local ainda não terminou de construir (ou numa sessão sem vault indexável), cai automaticamente no comportamento anterior: as ~5 notas com data de modificação mais recente, sem distinção de pasta.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: correct vault memory description — semantic search, not recency-only"
```

---

### Task 13: Verification — VAD canary, build, manual acceptance

**Files:** none (verification only, no code changes).

- [ ] **Step 1: Full clean build**

Run: `npm run build && npm run lint:design`
Expected: both succeed with no errors.

- [ ] **Step 2: VAD/voice regression canary (the dual-ONNX-runtime risk)**

Run: `npm run dev`, open the app, and:
1. Click the mic button, speak a short phrase, confirm voice-to-text still transcribes correctly (VAD + ElevenLabs Scribe path, unrelated to this plan's code but sharing `onnxruntime-web`).
2. Open DevTools console — confirm no errors mentioning `wasmPaths`, `SharedArrayBuffer`, or two conflicting ONNX runtime versions.

If voice breaks after this plan and worked before it, the dual-runtime risk flagged in `docs/HYBRID_MEMORY_PLAN.md` has materialized — stop and investigate before proceeding; do not paper over it by disabling one of the two runtimes' worker isolation.

- [ ] **Step 3: Manual acceptance with a real vault**

1. Connect a real Obsidian vault (readwrite), wait for `ÍNDICE` to appear on the status strip and disappear when done.
2. Ask JARVIS about a topic that exists **only** in an old note (not recently modified, not in `00-Inbox/`). Confirm the response reflects that note's content — the recency-only mechanism could never have surfaced it.
3. Open the `MEMÓRIA` panel and confirm the cited note is listed with a numeric score, and the footer reads "busca semântica + recência".
4. Start a fresh conversation about an unrelated technical topic; confirm a recently-saved unrelated note (e.g. a shopping list) does **not** appear in the panel just because it's new.

- [ ] **Step 4: Fallback verification**

1. In DevTools → Application → IndexedDB, delete the `jarvis-vault-index` entry (or clear the whole `jarvis-os` database).
2. Reload, ask a question. Confirm the chat still works, `MemoryPanel` shows "recência pura, sem busca" in the footer, and no error is visible to the user — this is the A7 graceful-degradation guarantee.

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin claude/vault-semantic-memory
gh pr create --title "feat(vault): local semantic memory search (Fase A)" --body "$(cat <<'EOF'
## Summary
- Replaces recency-only vault memory (top-5 most-recently-modified notes) with per-message semantic search over the whole vault
- 100% local: ONNX embeddings (Xenova/multilingual-e5-small) run in a Web Worker, isolated from VAD's onnxruntime-web instance
- Graceful degradation to the exact previous behavior whenever the index isn't ready

## Test plan
- [ ] `npm run build` and `npm run lint:design` clean
- [ ] `node --test src/lib` passes
- [ ] Voice input (VAD/Scribe) still works post-change — dual ONNX runtime canary
- [ ] Real vault: old, topically-relevant note surfaces in a response; recent-but-irrelevant note does not
- [ ] Deleting the IndexedDB index falls back to recency behavior with no visible error

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
