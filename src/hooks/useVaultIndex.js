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
import { chunkNote } from '../lib/chunker.js';
import { diffIndex, packVectors, unpackVector, search as vectorSearch, isIndexCompatible } from '../lib/vectorIndex.js';
import { embedTexts, warmup, setProgressListener } from '../lib/embedder.js';

const INDEX_KEY = 'jarvis-vault-index';
const INDEX_VERSION = 2;
const MODEL_ID = 'multilingual-e5-small';
const DIMS = 384;
const EMBED_BATCH = 16;
const MAX_HITS = 8;
const COSINE_WEIGHT = 0.75;
const RECENCY_WEIGHT = 0.25;
const RECENCY_HALFLIFE_DAYS = 30;
const DAY_MS = 86400000;

function emptyIndex() {
  return { version: INDEX_VERSION, model: MODEL_ID, dims: DIMS, updatedAt: 0, notes: {}, chunks: [], vectors: new Float32Array(0) };
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
  // índice, modelo ou dims diferente é descartado — reindexação completa,
  // não corrompe (isIndexCompatible em vectorIndex.js).
  useEffect(() => {
    (async () => {
      try {
        const saved = await idbGet(INDEX_KEY);
        indexRef.current = isIndexCompatible(saved, { version: INDEX_VERSION, model: MODEL_ID, dims: DIMS }) ? saved : emptyIndex();
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
      if (cancelled || buildTokenRef.current !== token) return;
      const oldIndex = indexRef.current;
      const { toEmbed, toRemove } = diffIndex(graph, oldIndex);

      if (toEmbed.length === 0 && toRemove.length === 0) {
        // 'ready' só depois do warmup resolver: se marcássemos 'ready' antes,
        // a primeira mensagem da sessão travaria esperando o cold start
        // (~118MB) inline no chat, e uma falha de warmup ficaria presa em
        // 'ready' pra sempre (toda busca futura pagando o timeout inteiro
        // antes do fallback de recência) — ver docs/HYBRID_MEMORY_PLAN.md.
        setStatus('loading-model');
        warmup().then(
          () => { if (!cancelled && buildTokenRef.current === token) setStatus('ready'); },
          () => { if (!cancelled && buildTokenRef.current === token) setStatus('unavailable'); }
        );
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
        const next = { version: INDEX_VERSION, model: MODEL_ID, dims: DIMS, updatedAt: Date.now(), notes: keptNotes, chunks: keptChunks, vectors };
        indexRef.current = next;
        try { await idbSet(INDEX_KEY, next); } catch (_) {}
        // mesmo motivo do branch acima — 'ready' só depois do warmup resolver.
        setStatus('loading-model');
        warmup().then(
          () => { if (!cancelled && buildTokenRef.current === token) setStatus('ready'); },
          () => { if (!cancelled && buildTokenRef.current === token) setStatus('unavailable'); }
        );
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

      try {
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
          const pieces = chunkNote(content, { path: entry.path, title: entry.title });
          if (pieces.length > 0) {
            const chunkStart = finalChunks.length;
            for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
              if (cancelled || buildTokenRef.current !== token) return;
              const batch = pieces.slice(i, i + EMBED_BATCH);
              const vectors = await embedTexts(batch.map(c => c.embeddingText), 'passage');
              batch.forEach((piece, j) => {
                finalChunks.push({ path: piece.path, title: piece.title, heading: piece.heading, headingPath: piece.headingPath, chunkIndex: piece.chunkIndex, text: piece.text });
                finalVectorList.push(vectors[j]);
              });
            }
            finalNotes[entry.path] = { mtime: entry.mtime, title: entry.title, chunkStart, chunkCount: pieces.length };
          }
          done++;
          setProgress({ done, total: toEmbed.length });
          await new Promise(r => setTimeout(r, 0)); // não trava a aba
        }
      } catch (_) {
        if (cancelled || buildTokenRef.current !== token) return;
        setStatus('unavailable'); // embed falhou no meio da indexação — useVault.js cai no fallback de recência
        return;
      }

      if (cancelled || buildTokenRef.current !== token) return;

      const vectors = packVectors(finalVectorList, DIMS);
      const next = { version: INDEX_VERSION, model: MODEL_ID, dims: DIMS, updatedAt: Date.now(), notes: finalNotes, chunks: finalChunks, vectors };
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
    try {
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
          byNote.set(hit.path, {
            title: note?.title || hit.path,
            path: hit.path,
            heading: hit.heading,
            headingPath: hit.headingPath,
            chunkIndex: hit.chunkIndex,
            chunkCount: note?.chunkCount,
            content: hit.text,
            score,
          });
        }
      }
      return [...byNote.values()].sort((a, b) => b.score - a.score).slice(0, MAX_HITS);
    } catch (_) {
      return [];
    }
  }, []);

  return { indexStatus: status, indexProgress: progress, searchMemory };
}
