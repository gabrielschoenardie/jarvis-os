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
