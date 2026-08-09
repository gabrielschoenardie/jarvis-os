// src/lib/embedder.js
// Cliente main-thread do embedder.worker.js: fila de promessas sobre
// postMessage, warm-up e progresso de carregamento do modelo. O worker só é
// criado no primeiro uso (lazy) — conectar o vault sem nunca perguntar nada
// não deve baixar/instanciar o modelo.

let worker = null;
let nextId = 1;
const pending = new Map();
let onProgress = null;
const CALL_TIMEOUT_MS = 15000; // embed(): consulta contra worker já quente — travar aqui é sinal real de problema
const WARMUP_TIMEOUT_MS = 120000; // warmup(): pode baixar + inicializar ~135MB (modelo + tokenizer) na primeira vez

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
      const dead = worker;
      worker = null; // permite recriar o worker na próxima chamada
      dead.terminate();
    };
  }
  return worker;
}

function call(message, timeoutMs = CALL_TIMEOUT_MS) {
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('embedder: timeout aguardando resposta do worker'));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timeout); resolve(v); },
      reject: (e) => { clearTimeout(timeout); reject(e); },
    });
    w.postMessage({ id, ...message });
  });
}

export function setProgressListener(fn) { onProgress = fn; }

export async function warmup() {
  await call({ type: 'warmup' }, WARMUP_TIMEOUT_MS);
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
