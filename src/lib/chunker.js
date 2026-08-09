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
