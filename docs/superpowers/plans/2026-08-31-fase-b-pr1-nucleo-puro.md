# Fase B · PR 1 — núcleo puro (handoff do Orchestrator)

> **Bloco de handoff.** Escrito pelo Orchestrator para ser executado por
> `ai_ml_worker` numa sessão limpa. Não é uma spec independente: a spec
> canônica é `docs/HYBRID_MEMORY_PLAN.md`, seções **B2, B3, B4, B5, B17, B18**.
> Este documento só marca o escopo do PR 1 e o que não pode ser mal lido.

**Repo:** `jarvis-os` (o vault é repo irmão e não se toca aqui)
**Base:** `main` @ `c4632d7` ou posterior · **Branch a criar:** `feat/fase-b-pr1-nucleo`
**Executor:** `ai_ml_worker`

> ⚠️ O plano de Fase B anterior (`2026-08-09-vault-index-sync-phase-b.md`) foi
> **removido no mesmo commit que criou este arquivo**. Era pré-v4 — descrevia
> Vercel Blob com proxy pelo servidor —, e o cabeçalho dirigido a agentic
> workers ainda parecia instrução válida para quem o encontrasse. Segue no
> histórico do git. A Fase B é definida **só** por `docs/HYBRID_MEMORY_PLAN.md`
> e por este handoff.

## Ler antes de escrever qualquer linha

1. `docs/HYBRID_MEMORY_PLAN.md` — B0.0, B2, B3, B4, B5, B17, B18. **É a fonte da verdade.**
2. `CLAUDE.md` § *Vault Semantic Memory (Fase A)* — invariantes.
3. `src/hooks/useVaultIndex.js` e `src/lib/vectorIndex.js` — a forma real do índice.

## Escopo — exatamente 4 módulos + 3 arquivos de teste

Puros: sem DOM, sem React, sem `fetch`, sem importar `idb.js`. Rodam em `node --test`.

| Arquivo | Superfície |
| --- | --- |
| `src/lib/indexCrypto.js` | `deriveKey(passphrase, salt, iterations)` · `encryptIndex(plainBytes, passphrase, {salt, iterations})` → bytes do objeto · `decryptIndex(objectBytes, passphrase)` → plainBytes · `newSalt()` (16B) · `newIv()` (12B) |
| `src/lib/indexSerialize.js` | `serializeIndex(index, {deviceId})` → `Uint8Array` · `deserializeIndex(bytes, {indexVersion, modelId, dims})` → índice, ou lança erro tipado |
| `src/lib/syncCapability.js` | `newSyncSecret()` (32B) · `objectIdFrom(syncSecret)` → 64 hex · `encodeSyncCode(secret)` / `decodeSyncCode(code)` |
| `src/lib/deviceId.js` | `getDeviceId(storage)` — UUID persistido; `storage` injetável, default `globalThis.localStorage`, para ser testável sem DOM |

**Testes**, colocados ao lado (padrão do repo): `indexCrypto.test.js`,
`indexSerialize.test.js`, `syncCapability.test.js`. **Escrever os testes
primeiro** — as listas completas estão em B17.

## Os dois formatos binários — B4 e B5, ao pé da letra

**Objeto (B4):** cabeçalho de 44 bytes em claro + ciphertext.

```text
magic "JVSYNC01" (8) · containerVer=1 (1) · kdfId=1 (1) · iterations uint32 BE (4)
  · saltLen=16 (1) · salt (16) · ivLen=12 (1) · iv (12) · ciphertext
```

- Os 44 bytes do cabeçalho são o **`additionalData` (AAD)** do AES-GCM. Não é
  opcional: é o que faz adulteração de salt/IV/iterations falhar na tag.
- **Não existe campo `authTag`** — o WebCrypto anexa a tag ao ciphertext.

**Envelope (B5):** é o *plaintext* que vai dentro do ciphertext.

```text
magic "JVIDXV01" (8) · envelopeVer=1 (1) · indexVersion uint16 BE (2)
  · dims uint16 BE (2) · modelIdLen uint8 (1) · modelId UTF-8
  · updatedAt uint64 BE (8) · payloadLen uint32 BE (4) · payload

payload: jsonLen uint32 BE (4) · meta JSON {notes, chunks, deviceId}
  · vetores Float32 LITTLE-ENDIAN
```

- Ler e escrever os vetores por `DataView` com `littleEndian = true`
  **explícito**. Não confiar na endianness da plataforma.
- As 8 validações de leitura de B5 são obrigatórias, e **rejeição nunca produz
  índice parcial**.

## Cinco coisas que um implementador erra sozinho

1. **De onde vêm `indexVersion` / `modelId` / `dims`.** Não importar
   `useVaultIndex.js` (arrastaria React para um módulo puro) e **não duplicar as
   constantes**. `serializeIndex` lê `version`/`model`/`dims` **do próprio objeto
   de índice**; `deserializeIndex` **recebe os esperados por parâmetro**, do
   chamador. Ver B0.0.
2. **`embeddingText` não é serializado.** Só `text`, igual ao que já é
   persistido em IndexedDB.
3. **`deviceId` não vive dentro do índice.** Entra no `meta` do envelope, vindo
   por parâmetro.
4. **PBKDF2-HMAC-SHA256, 600.000 iterações, dkLen 32.** Não trocar de KDF, não
   baixar o número.
5. **`salt` é por objeto e preservado entre escritas; `iv` é novo a cada
   cifragem.** Nunca derivar nem reaproveitar IV.

## Invariantes que este PR não pode violar

- Modelo `Xenova/multilingual-e5-small`, `q8`, **384 dims** — validado, nunca redefinido.
- `useVaultIndex.js`, `memoryContext.js`, `vectorIndex.js`, `chunker.js`,
  `embedder.js`, `embedder.worker.js`, `api/chat.js`, `vite.config.js` — **não tocar**.
- Retrieval permanece local e independente de rede.
- Passphrase nunca persistida em lugar nenhum.

## Fora do escopo deste PR (é o PR 2)

`api/memory-sync.js` (inclusive **remover** o legado), `indexSync.js`,
`useIndexSync.js`, CORS do bucket, presigned URLs, `MemoryPanel`,
`StatusStrip`, `.env.example`, `aws4fetch`.
**Nenhuma dependência nova em `package.json` neste PR.**

## Gates antes do PR

`npm test` (deve subir dos 49 testes atuais) · `npm run build` ·
`npm run lint:design` — os três verdes.
Usar `globalThis.crypto.subtle`; confirmar que passa no **Node 18**, o mínimo da
matriz do CI.

## Entrega

Branch → PR contra `main`. **Não commitar direto na `main`** — foi assim que o
`api/memory-sync.js` quebrado escapou de revisão. Reportar ao Orchestrator; não
invocar outro agente.
