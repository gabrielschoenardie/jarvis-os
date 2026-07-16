// Fase 2 do bloco de memória (ver jarvis-prompts.js, BLOCO 9): seleciona as
// notas mais recentemente modificadas do grafo já escaneado e monta um
// resumo narrativo em texto puro para o memoryContext do system prompt.
// Recência simples sobre o vault inteiro, sem embeddings — Capture notes
// recém-escritas (Fase 1) naturalmente sobem ao topo por terem o mtime mais
// novo, e saem de cena assim que notas mais novas existirem.

const MAX_NOTES = 5;
const MAX_EXCERPT_CHARS = 400;
const MAX_TOTAL_CHARS = 2000;

export function selectRecentNotes(graph, limit = MAX_NOTES) {
  if (!graph?.nodes) return [];
  return graph.nodes
    .filter(n => !n.ghost && n.path)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

function stripFrontmatter(text) {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  return end === -1 ? text : text.slice(end + 4);
}

function excerpt(text, max = MAX_EXCERPT_CHARS) {
  const body = stripFrontmatter(text).trim();
  return body.length > max ? body.slice(0, max) + '…' : body;
}

// entries: [{ title, content }] — content já lido do disco via readNote()
export function buildMemoryContext(entries) {
  const parts = [];
  let used = 0;
  for (const { title, content } of entries) {
    const piece = `— ${title}: ${excerpt(content)}`;
    if (used + piece.length > MAX_TOTAL_CHARS) break;
    parts.push(piece);
    used += piece.length;
  }
  if (parts.length === 0) return '';
  return `Notas recentes do vault (mais recentes primeiro):\n${parts.join('\n')}`;
}
