import { useState, useEffect, useRef, useCallback } from 'react';
import { idbGet, idbSet } from '../lib/idb.js';
import { parseWikilinks, buildGraph } from '../lib/vault-graph.js';

// Conexão com o vault Obsidian local via File System Access API (Chromium).
// 100% client-side: as notas nunca saem do navegador — só o conteúdo de UMA
// nota, quando o operador clica explicitamente em "ANALISAR COM JARVIS".
// O handle da pasta persiste em IndexedDB; nas visitas seguintes basta
// re-conceder a permissão com um clique (requestPermission exige gesto).

const HANDLE_KEY = 'jarvis-vault-handle';
const MAX_FILES = 4000;
const MAX_PARSE_BYTES = 2 * 1024 * 1024;
const YIELD_EVERY = 25;

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
        if (file.size > MAX_PARSE_BYTES) {
          words = Math.round(file.size / 6); // estimativa — pula o parse
        } else {
          const text = await file.text();
          targets = parseWikilinks(text);
          words = text.split(/\s+/).filter(Boolean).length;
          // corpo descartado aqui — só metadata + targets ficam em memória
        }
        files.push({ path: prefix + entry.name, name: entry.name, mtime: file.lastModified, size: file.size, targets, words });
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
      setError(err.message || 'falha ao varrer o vault');
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
        const perm = await handle.queryPermission({ mode: 'read' });
        if (cancelled) return;
        if (perm === 'granted') scanVault(handle);
        else setStatus('permission');
      } catch (_) { /* idb indisponível → segue em 'idle' */ }
    })();
    return () => { cancelled = true; };
  }, [supported, scanVault]);

  const connectVault = useCallback(async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      handleRef.current = handle;
      try { await idbSet(HANDLE_KEY, handle); } catch (_) {}
      await scanVault(handle);
    } catch (err) {
      if (err.name === 'AbortError') return; // usuário cancelou o picker
      setError(err.message);
      setStatus('error');
    }
  }, [scanVault]);

  const reconnectVault = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return connectVault();
    try {
      const perm = await handle.requestPermission({ mode: 'read' });
      if (perm === 'granted') await scanVault(handle);
      else setStatus('permission');
    } catch (_) {
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

  return {
    status, graph, progress, truncatedScan, error, scanId,
    connectVault, reconnectVault, rescanVault, readNote,
    layoutCacheRef,
  };
}
