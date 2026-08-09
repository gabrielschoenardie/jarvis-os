// Fase 2 do bloco de memória (ver jarvis-prompts.js, BLOCO 9): monta o texto
// de memoryContext a partir de um conjunto de notas já selecionadas —
// entries: [{ title, content, score? }]. Quem seleciona as entries mudou na
// Fase A (docs/HYBRID_MEMORY_PLAN.md): busca semântica por padrão
// (useVaultIndex.searchMemory), com selectRecentNotes como fallback de
// recência quando o índice não está pronto (ver useVault.js). Este módulo
// não sabe qual dos dois produziu as entries — só formata.

const MAX_NOTES = 5;
const MAX_EXCERPT_CHARS = 400;
const MAX_TOTAL_CHARS = 2000;
const CHARS_PER_TOKEN = 4; // estimativa de bolso pra prosa PT-BR/EN — não é
                            // a tokenização real do modelo, só o suficiente
                            // pro inspetor de memória (Etapa 6) dar uma noção
                            // de custo sem carregar um tokenizer no cliente.

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

// Monta os pedaços que entram no prompt, aplicando o mesmo teto de
// MAX_TOTAL_CHARS. Compartilhada por buildMemoryContext (o texto que
// efetivamente vai pro modelo) e buildMemoryDetail (o detalhamento do
// inspetor de memória) — garante que os dois nunca divirjam. `score` é
// opcional (presente quando as entries vêm de busca semântica, ausente no
// fallback de recência) e só passa adiante para exibição — nunca influencia
// o corte por caracteres nem o texto do prompt.
function selectParts(entries) {
  const parts = [];
  let used = 0;
  for (const { title, content, score } of entries) {
    const body = excerpt(content);
    const piece = `— ${title}: ${body}`;
    if (used + piece.length > MAX_TOTAL_CHARS) break;
    parts.push({ title, excerpt: body, piece, score });
    used += piece.length;
  }
  return parts;
}

// entries: [{ title, content, score? }] — content já lido do disco via
// readNote() ou vindo de um chunk já indexado.
export function buildMemoryContext(entries) {
  const parts = selectParts(entries);
  if (parts.length === 0) return '';
  return `Notas recentes do vault (mais recentes primeiro):\n${parts.map(p => p.piece).join('\n')}`;
}

// Detalhamento por nota do que está efetivamente no prompt agora — usado só
// pelo MemoryPanel (Etapa 6, só leitura; score exibido desde a Fase A).
// Nenhuma chamada aqui muda o texto produzido por buildMemoryContext.
export function buildMemoryDetail(entries) {
  const parts = selectParts(entries);
  const notes = parts.map(p => ({
    title: p.title,
    excerpt: p.excerpt,
    chars: p.piece.length,
    tokens: Math.ceil(p.piece.length / CHARS_PER_TOKEN),
    score: p.score,
  }));
  const totalChars = notes.reduce((sum, n) => sum + n.chars, 0);
  const totalTokens = notes.reduce((sum, n) => sum + n.tokens, 0);
  return { notes, totalChars, totalTokens };
}
