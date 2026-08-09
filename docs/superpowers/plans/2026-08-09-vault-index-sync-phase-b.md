# Vault Index Sync — Phase B (encrypted cloud sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the local semantic vault index (Phase A, `docs/superpowers/plans/2026-08-09-vault-semantic-memory-phase-a.md`) follow the operator across devices, without the server ever being able to read a single note. The server stores an opaque encrypted blob; only the browser holding the passphrase can decrypt it.

**Architecture:** `src/lib/indexCrypto.js` derives an AES-256-GCM key from a user passphrase via WebCrypto PBKDF2 (≥600k iterations, random salt) and encrypts/decrypts a serialized index. `src/lib/indexSync.js` serializes/deserializes the index (`Float32Array` isn't JSON-serializable as-is) and calls a new Edge Function, `api/memory-sync.js`, which stores/retrieves the ciphertext as a single blob in Vercel Blob storage — the server receives and returns bytes, never plaintext. A new `useMemorySync` hook wires push (debounced, after index updates) and pull (on connect) into `useVault.js`, gated behind the `VITE_MEMORY_SYNC_ENABLED` build flag so this entire subsystem is inert until explicitly turned on. `MemoryPanel.jsx` gains a `SINCRONIZAR` action and passphrase entry.

**Tech Stack:** WebCrypto (`crypto.subtle`, browser built-in), `@vercel/blob` (new dependency, Edge-compatible), the existing Vercel Edge runtime pattern from `api/chat.js`/`api/tts.js`.

## Global Constraints

- **This plan only starts after Phase A is merged and running in production.** Phase B builds directly on Phase A's index shape (`{version, model, dims, updatedAt, notes, chunks, vectors}`) and `useVaultIndex.js`.
- The passphrase never leaves the browser, and is never persisted to disk (no `localStorage`, no IndexedDB) — it lives only in React state for the current session. The user re-enters it each session by design; this plan does not add passphrase persistence.
- The server (`api/memory-sync.js`) must never receive or store plaintext. It only ever sees the AES-GCM ciphertext blob `indexCrypto.js` produces.
- PBKDF2 must use ≥600,000 iterations and a fresh random salt per encryption; AES-GCM must use a fresh random IV per encryption (never reuse an IV with the same key).
- The whole subsystem sits behind `VITE_MEMORY_SYNC_ENABLED` — with the flag unset (the default), none of this plan's code runs, and Phase A's behavior is completely unchanged.
- Rewriting the full ~8MB blob on every note edit is wasteful — v1 syncs on a long debounce after index changes settle, plus a manual `SINCRONIZAR` action. Delta/chunk-level sync is explicitly out of scope.
- `ANTHROPIC_API_KEY`/`ELEVENLABS_API_KEY` conventions (server-side only, from `CLAUDE.md`'s environment variable table) extend to the new `BLOB_READ_WRITE_TOKEN` — never expose it to the client bundle.

---

### Task 1: `indexCrypto.js` — PBKDF2 key derivation + AES-GCM encrypt/decrypt

**Files:**
- Create: `src/lib/indexCrypto.js`
- Test: `src/lib/indexCrypto.test.js`

**Interfaces:**
- Produces:
  - `encryptIndex(plaintext: Uint8Array, passphrase: string) => Promise<Uint8Array>` — self-contained blob: `[salt(16) | iv(12) | ciphertext]`.
  - `decryptIndex(blob: Uint8Array, passphrase: string) => Promise<Uint8Array>` — throws if the passphrase is wrong (AES-GCM auth tag check fails).
  - Consumed by Task 2 (`indexSync.js`).

**Note on running tests:** this module uses the WebCrypto global (`crypto.subtle`), available in Node ≥19 without imports and used identically in the browser. If `node --test` fails with `crypto is not defined` on the CI/dev machine's Node version, prefix the test file with `import { webcrypto } from 'node:crypto'; globalThis.crypto ??= webcrypto;` — do not change the production module to import from `node:crypto`, since it must run unmodified in the browser.

- [ ] **Step 1: Write the failing tests**

```js
// src/lib/indexCrypto.test.js
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptIndex, decryptIndex } from './indexCrypto.js';

test('encrypt→decrypt round-trip devolve o texto original', async () => {
  const plaintext = new TextEncoder().encode('{"notes":{},"chunks":[]}');
  const blob = await encryptIndex(plaintext, 'senha-correta');
  const decrypted = await decryptIndex(blob, 'senha-correta');
  assert.deepEqual([...decrypted], [...plaintext]);
});

test('passphrase errada falha ao decifrar (tag de autenticação AES-GCM)', async () => {
  const plaintext = new TextEncoder().encode('segredo');
  const blob = await encryptIndex(plaintext, 'senha-correta');
  await assert.rejects(() => decryptIndex(blob, 'senha-errada'));
});

test('duas cifragens da mesma passphrase produzem blobs diferentes (salt/IV aleatórios)', async () => {
  const plaintext = new TextEncoder().encode('mesmo conteúdo');
  const blobA = await encryptIndex(plaintext, 'senha');
  const blobB = await encryptIndex(plaintext, 'senha');
  assert.notDeepEqual([...blobA], [...blobB]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test src/lib/indexCrypto.test.js`
Expected: FAIL — `Cannot find module './indexCrypto.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/lib/indexCrypto.js
// Deriva uma chave AES-GCM de uma passphrase via PBKDF2 (WebCrypto) e
// cifra/decifra blobs. A chave nunca sai do navegador — o servidor
// (api/memory-sync.js) só armazena ciphertext opaco (docs/HYBRID_MEMORY_PLAN.md,
// Fase B).

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function concatBuffers(...buffers) {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) { out.set(new Uint8Array(b), offset); offset += b.byteLength; }
  return out;
}

// plaintext: Uint8Array. Retorna um único blob auto-contido:
// [salt(16) | iv(12) | ciphertext] — nada além da passphrase precisa ser
// guardado à parte pra decifrar depois.
export async function encryptIndex(plaintext, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return concatBuffers(salt, iv, ciphertext);
}

export async function decryptIndex(blob, passphrase) {
  const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
  const salt = bytes.slice(0, SALT_BYTES);
  const iv = bytes.slice(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const ciphertext = bytes.slice(SALT_BYTES + IV_BYTES);
  const key = await deriveKey(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Uint8Array(plaintext);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test src/lib/indexCrypto.test.js`
Expected: PASS (3/3)

- [ ] **Step 5: Add the test to the project test script and commit**

Modify `package.json`'s `test` script (from Phase A's `"node --test src/lib"` — verify it already picks up new `*.test.js` files under `src/lib` automatically; `node --test <dir>` recurses by default, so no change should be needed, but confirm with Step 4's own run before committing).

```bash
git add src/lib/indexCrypto.js src/lib/indexCrypto.test.js
git commit -m "feat(vault-sync): add PBKDF2 + AES-GCM index encryption"
```

---

### Task 2: `indexSync.js` — serialize, push, pull

**Files:**
- Create: `src/lib/indexSync.js`
- Test: `src/lib/indexSync.test.js` (serialization round-trip only — `push`/`pull` need a live endpoint and are covered by Task 6's manual verification instead)

**Interfaces:**
- Consumes: `encryptIndex`/`decryptIndex` (Task 1); the Phase A index shape from `useVaultIndex.js`.
- Produces:
  - `push(index, passphrase, deviceId) => Promise<void>` — PUTs the encrypted index to `/api/memory-sync`. Consumed by Task 4 (`useMemorySync.js`).
  - `pull(passphrase, localUpdatedAt) => Promise<{status:'empty'} | {status:'older'} | {status:'newer', index}>` — GETs and decrypts, comparing against the caller's local `updatedAt`. Consumed by Task 4.

- [ ] **Step 1: Write the failing test (serialization only)**

```js
// src/lib/indexSync.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeIndex, deserializeIndex } from './indexSync.js';

test('serializeIndex/deserializeIndex preserva Float32Array e metadata', () => {
  const index = {
    version: 1,
    model: 'multilingual-e5-small',
    dims: 3,
    updatedAt: 12345,
    notes: { 'a.md': { mtime: 100, title: 'A', chunkStart: 0, chunkCount: 1 } },
    chunks: [{ path: 'a.md', text: 'trecho' }],
    vectors: Float32Array.from([0.1, 0.2, 0.3]),
  };
  const bytes = serializeIndex(index);
  const restored = deserializeIndex(bytes);
  assert.equal(restored.dims, 3);
  assert.equal(restored.updatedAt, 12345);
  assert.deepEqual(restored.notes, index.notes);
  assert.deepEqual(restored.chunks, index.chunks);
  assert.ok(restored.vectors instanceof Float32Array);
  assert.deepEqual([...restored.vectors], [0.1, 0.2, 0.3]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/indexSync.test.js`
Expected: FAIL — `Cannot find module './indexSync.js'`

- [ ] **Step 3: Write the implementation**

```js
// src/lib/indexSync.js
// Sincroniza o índice semântico cifrado com api/memory-sync.js (Vercel
// Blob). last-write-wins por updatedAt: pull() avisa quando o remoto é mais
// novo que o local em vez de sobrescrever silenciosamente — quem decide
// aplicar é o caller (useMemorySync.js).

import { encryptIndex, decryptIndex } from './indexCrypto.js';

// Float32Array não sobrevive a JSON.stringify puro (vira {} vazio) —
// convertido explicitamente para array comum antes de serializar, e de
// volta depois. Puro: sem crypto, sem fetch — testável isoladamente.
export function serializeIndex(index) {
  const json = JSON.stringify({ ...index, vectors: Array.from(index.vectors) });
  return new TextEncoder().encode(json);
}

export function deserializeIndex(bytes) {
  const json = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(json);
  return { ...parsed, vectors: Float32Array.from(parsed.vectors) };
}

export async function push(index, passphrase, deviceId) {
  const payload = serializeIndex(index);
  const blob = await encryptIndex(payload, passphrase);
  const res = await fetch('/api/memory-sync', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Device-Id': deviceId },
    body: blob,
  });
  if (!res.ok) throw new Error(`falha ao sincronizar: HTTP ${res.status}`);
}

// Retorna { status: 'empty' } se nunca houve push, { status: 'older' } se o
// local já está em dia, ou { status: 'newer', index } se o remoto é mais
// novo que localUpdatedAt — o caller decide se aplica.
export async function pull(passphrase, localUpdatedAt) {
  const res = await fetch('/api/memory-sync');
  if (res.status === 404) return { status: 'empty' };
  if (!res.ok) throw new Error(`falha ao buscar sincronização: HTTP ${res.status}`);
  const remoteUpdatedAt = Number(res.headers.get('X-Updated-At') || 0);
  if (remoteUpdatedAt <= localUpdatedAt) return { status: 'older' };
  const blob = new Uint8Array(await res.arrayBuffer());
  const payload = await decryptIndex(blob, passphrase);
  const index = deserializeIndex(payload);
  return { status: 'newer', index };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/indexSync.test.js`
Expected: PASS (1/1)

- [ ] **Step 5: Commit**

```bash
git add src/lib/indexSync.js src/lib/indexSync.test.js
git commit -m "feat(vault-sync): add index serialization and push/pull client"
```

---

### Task 3: `api/memory-sync.js` — Edge Function backed by Vercel Blob

**Files:**
- Create: `api/memory-sync.js`
- Modify: `package.json` (add `@vercel/blob` dependency)
- Modify: `README.md` or `CLAUDE.md`'s environment variable table (document `BLOB_READ_WRITE_TOKEN`)

**Interfaces:**
- Consumes: `@vercel/blob`'s `put`/`head`.
- Produces: `GET /api/memory-sync` → `200` with the ciphertext body and an `X-Updated-At` header, or `404` if nothing was ever pushed. `PUT /api/memory-sync` with a raw ciphertext body → `200 {ok:true}`. Consumed by Task 2 (`indexSync.js`).

- [ ] **Step 1: Add the dependency**

In `package.json`'s `dependencies`:

```json
    "@vercel/blob": "^0.27.0",
```

- [ ] **Step 2: Write the Edge Function**

```js
// api/memory-sync.js
// Edge Function: GET/PUT de um blob opaco de sincronização de memória. O
// corpo já chega cifrado (AES-GCM, ver src/lib/indexCrypto.js) — o servidor
// nunca vê o índice em claro, só grava/lê bytes. `X-Updated-At` no GET vem do
// timestamp de upload do blob (proxy razoável pro updatedAt do índice, já
// que o PUT acontece logo após cifrar) — não há metadata customizada
// persistida além disso na v1.

import { put, head } from '@vercel/blob';

export const config = { runtime: 'edge' };

const BLOB_PATH = 'jarvis-memory-sync/index.bin';

export default async function handler(req) {
  if (req.method === 'GET') {
    try {
      const info = await head(BLOB_PATH, { token: process.env.BLOB_READ_WRITE_TOKEN });
      const fileRes = await fetch(info.url);
      const body = await fileRes.arrayBuffer();
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Updated-At': info.uploadedAt ? String(new Date(info.uploadedAt).getTime()) : '0',
        },
      });
    } catch (_err) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (req.method === 'PUT') {
    const body = await req.arrayBuffer();
    await put(BLOB_PATH, body, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/octet-stream',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, PUT' } });
}
```

- [ ] **Step 3: Document the new environment variable**

In `CLAUDE.md`'s "Environment variables" table, add a row:

```markdown
| `BLOB_READ_WRITE_TOKEN` | Server | Vercel Blob access for encrypted memory-index sync (Fase B) |
```

Note in the surrounding prose that, like `ANTHROPIC_API_KEY`/`ELEVENLABS_API_KEY`, this token lives server-side only.

- [ ] **Step 4: Provision Vercel Blob and verify locally**

This step requires access to the Vercel project dashboard — flag to the human operator if running unattended:
1. In the Vercel dashboard, create a Blob store for this project (Storage tab) and copy the generated `BLOB_READ_WRITE_TOKEN`.
2. Add it to `.env` locally (already gitignored) and to the Vercel project's environment variables (Production + Preview).
3. Run `npm run dev`, then `curl -X PUT --data-binary "test-ciphertext" http://localhost:5173/api/memory-sync` followed by `curl -i http://localhost:5173/api/memory-sync` — expect the second call to return the same bytes with an `X-Updated-At` header.

- [ ] **Step 5: Commit**

```bash
git add api/memory-sync.js package.json package-lock.json CLAUDE.md
git commit -m "feat(vault-sync): add memory-sync Edge Function backed by Vercel Blob"
```

---

### Task 4: `useMemorySync.js` — debounced push, pull-on-connect, behind a flag

**Files:**
- Create: `src/hooks/useMemorySync.js`
- Modify: `src/hooks/useVault.js` (wire it in, gated by the flag)

**Interfaces:**
- Consumes: `push`/`pull` (Task 2); the index object and `indexStatus` from `useVaultIndex.js` (Phase A).
- Produces: `useMemorySync({ index, indexStatus, applyRemoteIndex }) => { syncEnabled, passphrase, setPassphrase, syncStatus, syncNow, checkRemote }`. Consumed by Task 6 (`MemoryPanel.jsx`) via `useVault.js`'s return value.

- [ ] **Step 1: Write the hook**

```js
// src/hooks/useMemorySync.js
// Fase B (docs/HYBRID_MEMORY_PLAN.md) — sincronização de índice cifrado,
// atrás da flag VITE_MEMORY_SYNC_ENABLED. A passphrase só vive em memória
// (state React) nesta sessão — nunca persiste em disco/localStorage; o
// operador re-digita a cada sessão por design.

import { useState, useCallback, useRef } from 'react';
import { push, pull } from '../lib/indexSync.js';

const SYNC_ENABLED = import.meta.env.VITE_MEMORY_SYNC_ENABLED === 'true';
const PUSH_DEBOUNCE_MS = 30_000;
const DEVICE_ID_KEY = 'jarvis-device-id';

// deviceId não é secreto — só identifica qual navegador fez o último push,
// pra diagnóstico. Pode viver em localStorage sem risco de privacidade.
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// index: o índice atual (de useVaultIndex, via useVault.js) ou null.
// applyRemoteIndex: callback pra aplicar um índice remoto mais novo quando o
// operador aceitar explicitamente (checkRemote nunca aplica sozinho).
export function useMemorySync({ index, applyRemoteIndex }) {
  const [passphrase, setPassphrase] = useState('');
  const [syncStatus, setSyncStatus] = useState('idle'); // idle | syncing | synced | error | remote-newer
  const pushTimeoutRef = useRef(null);
  const deviceIdRef = useRef(null);

  const syncNow = useCallback(async () => {
    if (!SYNC_ENABLED || !passphrase || !index) return;
    if (!deviceIdRef.current) deviceIdRef.current = getDeviceId();
    setSyncStatus('syncing');
    try {
      await push(index, passphrase, deviceIdRef.current);
      setSyncStatus('synced');
    } catch (_) {
      setSyncStatus('error');
    }
  }, [passphrase, index]);

  // Não aplica automaticamente — só sinaliza. O operador decide via UI
  // (MemoryPanel) se quer puxar o remoto por cima do local.
  const checkRemote = useCallback(async () => {
    if (!SYNC_ENABLED || !passphrase || !index) return;
    try {
      const result = await pull(passphrase, index.updatedAt);
      if (result.status === 'newer') setSyncStatus('remote-newer');
    } catch (_) {
      setSyncStatus('error');
    }
  }, [passphrase, index]);

  const applyRemote = useCallback(async () => {
    if (!SYNC_ENABLED || !passphrase) return;
    setSyncStatus('syncing');
    try {
      const result = await pull(passphrase, -1); // -1 força status 'newer' se existir algo remoto
      if (result.status === 'newer') {
        applyRemoteIndex(result.index);
        setSyncStatus('synced');
      } else {
        setSyncStatus('idle');
      }
    } catch (_) {
      setSyncStatus('error');
    }
  }, [passphrase, applyRemoteIndex]);

  // Debounce longo (30s) após o índice mudar — reescrever ~8MB a cada nota
  // editada é desperdício (docs/HYBRID_MEMORY_PLAN.md, Fase B). Chamado por
  // useVault.js quando o índice local termina de atualizar.
  const schedulePush = useCallback(() => {
    if (!SYNC_ENABLED || !passphrase) return;
    if (pushTimeoutRef.current) clearTimeout(pushTimeoutRef.current);
    pushTimeoutRef.current = setTimeout(syncNow, PUSH_DEBOUNCE_MS);
  }, [passphrase, syncNow]);

  return { syncEnabled: SYNC_ENABLED, passphrase, setPassphrase, syncStatus, syncNow, checkRemote, applyRemote, schedulePush };
}
```

- [ ] **Step 2: Wire it into `useVault.js`**

In `src/hooks/useVault.js`, add the import:

```js
import { useMemorySync } from './useMemorySync.js';
```

After the `searchMemory` definition (Phase A), add:

```js
  // Fase B: sincronização opt-in, atrás de VITE_MEMORY_SYNC_ENABLED — com a
  // flag desligada (padrão), useMemorySync devolve syncEnabled:false e não
  // faz nada. applyRemoteIndex substitui o índice local só quando o operador
  // aceita explicitamente um remoto mais novo (nunca automático).
  const memorySync = useMemorySync({
    index: indexStatus === 'ready' ? undefined : undefined, // preenchido no Passo 3 abaixo
    applyRemoteIndex: () => {},
  });
```

This intermediate stub is intentionally incomplete — Step 3 fills it in correctly, because `useVaultIndex.js` (Phase A) doesn't currently expose its raw `index` object, only derived `indexStatus`/`indexProgress`/`searchMemory`. Do not commit after this step.

- [ ] **Step 3: Expose the raw index from `useVaultIndex.js` and finish the wiring**

In `src/hooks/useVaultIndex.js` (Phase A), change the hook's return statement from:

```js
  return { indexStatus: status, indexProgress: progress, searchMemory };
```

to:

```js
  return { indexStatus: status, indexProgress: progress, searchMemory, getIndex: () => indexRef.current, applyIndex: (next) => { indexRef.current = next; idbSet(INDEX_KEY, next).catch(() => {}); } };
```

Then in `src/hooks/useVault.js`, replace the stub from Step 2 with the real wiring, and destructure the two new fields from `useVaultIndex`:

```js
  const { indexStatus, indexProgress, searchMemory: semanticSearch, getIndex, applyIndex } = useVaultIndex(graph, scanId, readNote);

  // ... searchMemory (Fase A, unchanged) stays here ...

  // Fase B: sincronização opt-in, atrás de VITE_MEMORY_SYNC_ENABLED — com a
  // flag desligada (padrão), useMemorySync devolve syncEnabled:false e não
  // faz nada. applyIndex substitui o índice local só quando o operador
  // aceita explicitamente um remoto mais novo (nunca automático).
  const memorySync = useMemorySync({
    index: indexStatus === 'ready' ? getIndex() : null,
    applyRemoteIndex: applyIndex,
  });

  useEffect(() => {
    if (indexStatus === 'ready') memorySync.schedulePush();
  }, [indexStatus, memorySync]);
```

Add `memorySync` to `useVault.js`'s returned object:

```js
  return {
    status, graph, progress, truncatedScan, error, scanId, canWrite,
    searchMemory, memoryDetail, indexStatus, indexProgress, memorySync,
    connectVault, reconnectVault, rescanVault, readNote, writeCaptureNote,
    layoutCacheRef,
  };
```

- [ ] **Step 4: Verify the build succeeds with the flag off**

Run: `npm run build`
Expected: clean build. `import.meta.env.VITE_MEMORY_SYNC_ENABLED` is `undefined` in this build (no `.env` entry yet) — `SYNC_ENABLED` evaluates to `false`, so `useMemorySync`'s callbacks are all no-ops. This is the default, safe state.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMemorySync.js src/hooks/useVault.js src/hooks/useVaultIndex.js
git commit -m "feat(vault-sync): wire debounced push/pull into useVault, behind VITE_MEMORY_SYNC_ENABLED"
```

---

### Task 5: `MemoryPanel.jsx` — `SINCRONIZAR` action and passphrase entry

**Files:**
- Modify: `src/components/MemoryPanel.jsx`

**Interfaces:**
- Consumes: `sync` prop (Task 4's `memorySync` object, passed from `App.jsx` in Task 6).

- [ ] **Step 1: Add the sync footer section**

In `src/components/MemoryPanel.jsx`, change the function signature and add a sync block. Full file:

```jsx
// src/components/MemoryPanel.jsx
import { useEffect, useRef, useState } from 'react';
import { C, mono, z } from '../lib/constants.js';
import { HoloPanel } from './hud/index.js';

// Inspetor de memória (Etapa 6, só leitura pro texto do prompt). Desde a
// Fase B (docs/HYBRID_MEMORY_PLAN.md), também é a superfície de
// sincronização: `sync` (vault.memorySync de useVault.js) só existe de
// verdade com VITE_MEMORY_SYNC_ENABLED=true — `sync.syncEnabled` decide se a
// seção SINCRONIZAR aparece. Sem a flag, o painel se comporta exatamente
// como antes da Fase B.
export function MemoryPanel({ detail, onClose, sync }) {
  const closeBtnRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const [passphraseInput, setPassphraseInput] = useState('');

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

  const syncLabel = {
    idle: 'sincronizar', syncing: 'sincronizando…', synced: 'sincronizado ✓',
    error: 'falhou — tentar de novo', 'remote-newer': 'versão remota mais nova disponível',
  }[sync?.syncStatus] || 'sincronizar';

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

          {sync?.syncEnabled && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
              {!sync.passphrase ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="password"
                    value={passphraseInput}
                    onChange={e => setPassphraseInput(e.target.value)}
                    placeholder="passphrase de sincronização"
                    style={{ flex: 1, background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.text, fontSize: 11, padding: '6px 8px', fontFamily: 'inherit' }}
                  />
                  <button
                    onClick={() => sync.setPassphrase(passphraseInput)}
                    disabled={!passphraseInput}
                    style={{ background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accent, fontSize: 10, letterSpacing: '0.08em', padding: '6px 10px', cursor: passphraseInput ? 'pointer' : 'default', fontFamily: 'inherit' }}
                  >DESBLOQUEAR</button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, color: C.muted, letterSpacing: '0.06em' }}>
                    {sync.syncStatus === 'remote-newer' ? 'versão remota mais nova' : 'sincronização'}
                  </span>
                  {sync.syncStatus === 'remote-newer' ? (
                    <button onClick={sync.applyRemote} style={{ background: 'transparent', border: `1px solid ${C.accent}`, color: C.accent, fontSize: 10, letterSpacing: '0.08em', padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>APLICAR REMOTO</button>
                  ) : (
                    <button onClick={sync.syncNow} disabled={sync.syncStatus === 'syncing'} style={{ background: 'transparent', border: `1px solid ${C.accentDim}`, color: C.accent, fontSize: 10, letterSpacing: '0.08em', padding: '4px 10px', cursor: sync.syncStatus === 'syncing' ? 'default' : 'pointer', fontFamily: 'inherit' }}>{syncLabel.toUpperCase()}</button>
                  )}
                </div>
              )}
            </div>
          )}
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
git commit -m "feat(vault-sync): add SINCRONIZAR action and passphrase entry to MemoryPanel"
```

---

### Task 6: `App.jsx` — pass `memorySync` through, check remote on connect

**Files:**
- Modify: `src/App.jsx:425` (the `<MemoryPanel>` render)
- Modify: `src/App.jsx` (vault connect flow)

**Interfaces:**
- Consumes: `vault.memorySync` from Task 4.

- [ ] **Step 1: Pass `sync` into `MemoryPanel`**

```jsx
// Before
      {memoryPanelOpen && (
        <MemoryPanel detail={vault.memoryDetail} onClose={() => setMemoryPanelOpen(false)} />
      )}
```

```jsx
// After
      {memoryPanelOpen && (
        <MemoryPanel detail={vault.memoryDetail} onClose={() => setMemoryPanelOpen(false)} sync={vault.memorySync} />
      )}
```

- [ ] **Step 2: Check for a newer remote index once the local index is ready**

Add an effect near the other vault-related effects in `App.jsx` (after the `chat`/`memoryNoteCount` block, around line 115):

```js
  // Fase B: se a sincronização está ligada e desbloqueada, confere uma vez
  // por conexão se existe uma versão remota mais nova — nunca aplica
  // sozinho, só sinaliza (vault.memorySync.syncStatus === 'remote-newer'),
  // pro operador decidir em MemoryPanel.
  useEffect(() => {
    if (vault.indexStatus === 'ready' && vault.memorySync.syncEnabled && vault.memorySync.passphrase) {
      vault.memorySync.checkRemote();
    }
  }, [vault.indexStatus, vault.memorySync.syncEnabled, vault.memorySync.passphrase]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Verify the build succeeds**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(vault-sync): wire memorySync into App, check remote on index ready"
```

---

### Task 7: Verification — two-device round trip, wrong-passphrase safety, flag-off no-op

**Files:** none (verification only).

- [ ] **Step 1: Full clean build with the flag off (default)**

Run: `npm run build`
Expected: clean build. Confirm via `grep -r VITE_MEMORY_SYNC_ENABLED .env` that the flag is unset — this is the state every existing user is in immediately after this PR merges.

- [ ] **Step 2: Enable the flag locally and verify the round trip**

1. Add `VITE_MEMORY_SYNC_ENABLED=true` to `.env`, restart `npm run dev`.
2. Connect a vault, wait for the local index to be `ready`.
3. Open `MemoryPanel`, enter a passphrase, click `DESBLOQUEAR`, then `SINCRONIZAR`. Confirm `syncStatus` reaches `synced`.
4. In a second browser profile (or after clearing IndexedDB in the same browser to simulate "new device"), connect the same vault, unlock with the **same** passphrase, and trigger `checkRemote` (reload after setting the passphrase). Confirm `remote-newer` appears and `APLICAR REMOTO` successfully loads the synced index (verify by searching for a note that only exists in the first device's index).

- [ ] **Step 3: Wrong-passphrase safety**

Attempt to unlock/apply-remote with an incorrect passphrase. Confirm `decryptIndex` rejects (per Task 1's test), `syncStatus` becomes `error`, and no plaintext or partial data is ever written to `indexRef.current` — a failed decrypt must leave the local index untouched.

- [ ] **Step 4: Server never sees plaintext**

With the flag on, inspect the Network tab during a `SINCRONIZAR` action: confirm the `PUT /api/memory-sync` request body is opaque binary (not readable JSON) — this is the core privacy guarantee of this phase.

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin claude/vault-index-sync
gh pr create --title "feat(vault-sync): encrypted cloud sync for the semantic index (Fase B)" --body "$(cat <<'EOF'
## Summary
- Syncs the local semantic vault index (Fase A) across devices via an AES-GCM-encrypted blob in Vercel Blob
- Server never sees plaintext — passphrase-derived key (PBKDF2, 600k iterations) never leaves the browser
- Entirely behind VITE_MEMORY_SYNC_ENABLED; default (unset) behavior is unchanged from Fase A

## Test plan
- [ ] `npm run build` clean with the flag unset (default/no-op verified)
- [ ] `node --test src/lib` passes (indexCrypto round-trip + wrong-passphrase rejection + indexSync serialization)
- [ ] Two-device round trip: push from device A, pull+apply on device B, confirm a device-A-only note is searchable on B
- [ ] Wrong passphrase fails safely, local index untouched
- [ ] Network tab confirms PUT body is opaque ciphertext

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
