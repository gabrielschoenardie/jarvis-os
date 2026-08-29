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

const MIN_COMPOSITE_CHARS = 160;

// Encontra a melhor fronteira de corte dentro de `slice`, procurando a
// partir do final (direction 'backward', usado na cabeça) ou do início
// (direction 'forward', usado na cauda), na prioridade: parágrafo > fim de
// frase > espaço. Só aceita a fronteira se ela não descartar mais que 30%
// do orçamento (`budget`); senão recua/avança só até o último/próximo
// espaço, pra nunca cortar palavra no meio.
function findBoundary(slice, budget, direction) {
  const maxDiscard = Math.floor(budget * 0.3);

  if (direction === 'backward') {
    // cabeça: procura a fronteira mais próxima do FIM de `slice`.
    const paraIdx = slice.lastIndexOf('\n\n');
    if (paraIdx !== -1 && slice.length - (paraIdx + 2) <= maxDiscard) {
      return slice.slice(0, paraIdx + 2);
    }
    const sentenceIdx = lastSentenceEnd(slice);
    if (sentenceIdx !== -1 && slice.length - sentenceIdx <= maxDiscard) {
      return slice.slice(0, sentenceIdx);
    }
    const spaceIdx = slice.lastIndexOf(' ');
    if (spaceIdx !== -1) return slice.slice(0, spaceIdx);
    return slice;
  }

  // forward: cauda — procura a fronteira mais próxima do INÍCIO de `slice`.
  const paraIdx = slice.indexOf('\n\n');
  if (paraIdx !== -1 && paraIdx + 2 <= maxDiscard) {
    return slice.slice(paraIdx + 2);
  }
  const sentenceIdx = firstSentenceEnd(slice);
  if (sentenceIdx !== -1 && sentenceIdx <= maxDiscard) {
    return slice.slice(sentenceIdx);
  }
  const spaceIdx = slice.indexOf(' ');
  if (spaceIdx !== -1) return slice.slice(spaceIdx + 1);
  return slice;
}

// Índice (exclusivo) logo após o último "fim de frase" (. ! ? :) seguido de
// espaço ou fim de string, dentro de `slice`.
function lastSentenceEnd(slice) {
  for (let i = slice.length - 1; i >= 0; i--) {
    const ch = slice[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === ':') {
      const next = slice[i + 1];
      if (next === undefined || next === ' ' || next === '\n') {
        return i + 1;
      }
    }
  }
  return -1;
}

// Índice do primeiro caractere após o primeiro "fim de frase" em `slice`.
function firstSentenceEnd(slice) {
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    if (ch === '.' || ch === '!' || ch === '?' || ch === ':') {
      const next = slice[i + 1];
      if (next === undefined || next === ' ' || next === '\n') {
        return i + 1;
      }
    }
  }
  return -1;
}

// Corte simples na fronteira de palavra (sem passar de `max`), com '…'.
function simpleTruncate(body, max) {
  if (max <= 1) return body.slice(0, Math.max(0, max));
  const budget = max - 1; // reserva 1 char pro '…'
  let slice = body.slice(0, budget);
  const spaceIdx = slice.lastIndexOf(' ');
  if (spaceIdx !== -1) slice = slice.slice(0, spaceIdx);
  return slice.trimEnd() + '…';
}

// Constrói um excerto de até `maxChars` a partir de `text`, priorizando
// pegar o texto inteiro quando cabe, e senão uma janela composta
// (início + fim) em vez de só o início — o embedding não dá offset de onde
// no chunk está o sinal semântico relevante (§11).
export function buildRelevantExcerpt(text, maxChars) {
  const body = stripFrontmatter(text).trim();
  if (body.length <= maxChars) return body;

  if (maxChars < MIN_COMPOSITE_CHARS) {
    return simpleTruncate(body, maxChars);
  }

  const SEP = ' … ';
  const budget = maxChars - SEP.length;
  const headBudget = Math.ceil(budget * 0.6);
  const tailBudget = budget - headBudget;

  const headSlice = body.slice(0, headBudget);
  const head = findBoundary(headSlice, headBudget, 'backward').trim();

  const tailSlice = body.slice(body.length - tailBudget);
  const tail = findBoundary(tailSlice, tailBudget, 'forward').trim();

  let result = `${head} … ${tail}`;
  if (result.length > maxChars) {
    // Invariante duro: nunca exceder maxChars. Apara a cauda até caber.
    const overflow = result.length - maxChars;
    const newTail = tail.slice(0, Math.max(0, tail.length - overflow)).trimEnd();
    result = `${head} … ${newTail}`;
    if (result.length > maxChars) {
      result = result.slice(0, maxChars);
    }
  }
  return result;
}

// Monta os pedaços que entram no prompt, aplicando o mesmo teto de
// MAX_TOTAL_CHARS, em duas passadas: (1) breadth — cada entry recebe até
// MAX_EXCERPT_CHARS, pra ninguém ser esfomeado; (2) depth — a sobra do
// orçamento de 2000 é redistribuída em ordem de score, expandindo as
// entries truncadas na passada 1 até no máximo o texto integral de cada
// uma. Compartilhada por buildMemoryContext (o texto que efetivamente vai
// pro modelo) e buildMemoryDetail (o detalhamento do inspetor de memória)
// — garante que os dois nunca divirjam. `score`/`path`/`heading`/
// `headingPath`/`chunkIndex`/`chunkCount` são opcionais (ausentes no
// fallback de recência) e só passam adiante para exibição — nunca
// influenciam o corte por caracteres nem o texto do prompt.
function selectParts(entries) {
  const parts = [];
  let used = 0;

  // Passada 1 — breadth.
  for (const entry of entries) {
    const { title, content, score, path, heading, headingPath, chunkIndex, chunkCount } = entry;
    const body = buildRelevantExcerpt(content, MAX_EXCERPT_CHARS);
    const piece = `— ${title}: ${body}`;
    if (used + piece.length > MAX_TOTAL_CHARS) break;
    parts.push({
      title,
      content,
      excerpt: body,
      piece,
      score,
      path,
      heading,
      headingPath,
      chunkIndex,
      chunkCount,
    });
    used += piece.length;
  }

  // Passada 2 — depth: redistribui a sobra em ordem de score (ordem de
  // entrada), expandindo entries ainda truncadas até o texto integral.
  let leftover = MAX_TOTAL_CHARS - used;
  for (const part of parts) {
    if (leftover <= 0) break;
    const fullBody = stripFrontmatter(part.content).trim();
    if (fullBody.length <= part.excerpt.length) continue; // já está completo

    const newCap = part.excerpt.length + leftover;
    const newBody = buildRelevantExcerpt(part.content, newCap);
    if (newBody.length <= part.excerpt.length) continue;

    const newPiece = `— ${part.title}: ${newBody}`;
    const delta = newPiece.length - part.piece.length;
    if (delta <= 0) continue;

    used += delta;
    leftover -= delta;
    part.excerpt = newBody;
    part.piece = newPiece;
  }

  // `content` não deve vazar no objeto retornado (uso interno da passada 2).
  return parts.map(({ content: _content, ...rest }) => rest);
}

// entries: [{ title, content, score?, path?, heading?, headingPath?,
// chunkIndex?, chunkCount? }] — content já lido do disco via readNote() ou
// vindo de um chunk já indexado. `mode`: 'semantic' | 'recency' (default).
export function buildMemoryContext(entries, { mode = 'recency' } = {}) {
  const parts = selectParts(entries);
  if (parts.length === 0) return '';
  const label = mode === 'semantic'
    ? 'Contexto relevante recuperado do vault:'
    : 'Notas recentes do vault:';
  return `${label}\n${parts.map(p => p.piece).join('\n')}`;
}

// Detalhamento por nota do que está efetivamente no prompt agora — usado só
// pelo MemoryPanel (Etapa 6, só leitura; score exibido desde a Fase A).
// Nenhuma chamada aqui muda o texto produzido por buildMemoryContext — usa
// a mesma selectParts, com os mesmos argumentos, pra garantir simetria.
export function buildMemoryDetail(entries, { mode = 'recency' } = {}) {
  const parts = selectParts(entries);
  const notes = parts.map(p => ({
    title: p.title,
    path: p.path,
    heading: p.heading,
    headingPath: p.headingPath,
    chunkIndex: p.chunkIndex,
    chunkCount: p.chunkCount,
    excerpt: p.excerpt,
    chars: p.piece.length,
    tokens: Math.ceil(p.piece.length / CHARS_PER_TOKEN),
    score: p.score,
  }));
  const totalChars = notes.reduce((sum, n) => sum + n.chars, 0);
  const totalTokens = notes.reduce((sum, n) => sum + n.tokens, 0);
  return { notes, totalChars, totalTokens };
}
