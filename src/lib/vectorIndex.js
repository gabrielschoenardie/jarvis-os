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

// Um índice salvo é reutilizável só se version/model/dims baterem exatamente
// com o esperado agora. Qualquer divergência (dims mudou, modelo trocou, ou
// INDEX_VERSION subiu por causa de uma mudança de formato — ex.: metadata de
// heading nova) é descartada e o índice reconstrói do zero na próxima
// varredura. Isso é seguro porque o índice é inteiramente derivável do vault
// a qualquer momento — mas a invalidação apaga só a chave do índice do
// JARVIS (jarvis-vault-index) em IndexedDB, nunca o banco inteiro.
export function isIndexCompatible(saved, { version, model, dims }) {
  if (!saved || typeof saved !== 'object') return false;
  return saved.version === version && saved.model === model && saved.dims === dims;
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
    title: chunk.title,
    heading: chunk.heading,
    headingPath: chunk.headingPath,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    score: dot(unpackVector(vectors, i, dims), queryVec),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
