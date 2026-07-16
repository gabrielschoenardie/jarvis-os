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
    connectVault, reconnectVault, rescanVault, readNote, writeCaptureNote,
    layoutCacheRef,
  };
}
