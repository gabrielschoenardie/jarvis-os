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
