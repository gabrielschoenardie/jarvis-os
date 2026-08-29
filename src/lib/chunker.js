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

// Corte "puro" por offsets: devolve [{ text, start, end }] com o mesmo
// algoritmo bit-a-bit de sempre (findBreak, overlap, filter/trim). start/end
// são offsets dentro de `text` (já sem frontmatter e trimado).
function cutChunks(text, size, overlap) {
  if (!text) return [];
  if (text.length <= size) return [{ text, start: 0, end: text.length }];

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(start + size, text.length);
    if (hardEnd >= text.length) {
      chunks.push({ text: text.slice(start).trim(), start, end: text.length });
      break;
    }
    const breakAt = findBreak(text, start, hardEnd);
    chunks.push({ text: text.slice(start, breakAt).trim(), start, end: breakAt });
    start = Math.max(breakAt - overlap, start + 1);
  }
  return chunks.filter(c => Boolean(c.text));
}

export function chunkText(rawText, { size = CHUNK_SIZE, overlap = CHUNK_OVERLAP } = {}) {
  const text = stripFrontmatter(rawText || '').trim();
  if (!text) return [];
  return cutChunks(text, size, overlap).map(c => c.text);
}

// Coleta headings (# a ######) do texto processado, uma única vez, com seus
// offsets absolutos. Ignora linhas dentro de fences ```. Espelha o cuidado
// que parseWikilinks (vault-graph.js) toma com fences.
function collectHeadings(text) {
  const headings = [];
  let offset = 0;
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^```/.test(line)) {
      inFence = !inFence;
    } else if (!inFence) {
      const m = /^(#{1,6})\s+(.*)$/.exec(line);
      if (m) headings.push({ offset, level: m[1].length, title: m[2].trim() });
    }
    offset += line.length + 1;
  }
  return headings;
}

// Resolve, para um offset de heading vencedor, a hierarquia completa até ele
// (headingPath). Usa a pilha de níveis: um heading de nível N substitui
// qualquer heading do mesmo nível ou mais profundo já empilhado.
function resolveHeadingPath(headings, offset) {
  if (offset === undefined) return { heading: undefined, headingPath: undefined };
  const stack = [];
  for (const h of headings) {
    if (h.offset > offset) break;
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push(h);
  }
  if (stack.length === 0) return { heading: undefined, headingPath: undefined };
  const heading = stack[stack.length - 1].title;
  const headingPath = stack.map(h => h.title).join(' > ');
  return { heading, headingPath };
}

// Os headings particionam o texto em segmentos: headings[i] cobre
// [headings[i].offset, headings[i+1].offset) (o último vai até textLength);
// o trecho antes do primeiro heading é o segmento "sem heading" (offset
// undefined). Devolve o offset do heading cujo segmento tem maior
// sobreposição com [start, end) — empate resolvido a favor do menor offset,
// já garantido pela ordem de iteração (headings estão em ordem crescente e a
// comparação usa estritamente ">").
function dominantHeadingOffset(headings, start, end, textLength) {
  let bestOffset; // undefined = segmento "sem heading"
  let bestOverlap = -1;

  const noHeadingEnd = headings.length ? headings[0].offset : textLength;
  const noHeadingOverlap = Math.max(0, Math.min(end, noHeadingEnd) - Math.max(start, 0));
  if (noHeadingOverlap > bestOverlap) {
    bestOverlap = noHeadingOverlap;
    bestOffset = undefined;
  }

  for (let i = 0; i < headings.length; i++) {
    const segStart = headings[i].offset;
    const segEnd = i + 1 < headings.length ? headings[i + 1].offset : textLength;
    const overlap = Math.max(0, Math.min(end, segEnd) - Math.max(start, segStart));
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestOffset = segStart;
    }
  }

  return bestOffset;
}

export function chunkNote(rawText, meta = {}, opts = {}) {
  const { size = CHUNK_SIZE, overlap = CHUNK_OVERLAP } = opts;
  const { path, title } = meta;
  const text = stripFrontmatter(rawText || '').trim();
  if (!text) return [];

  const headings = collectHeadings(text);
  const cut = cutChunks(text, size, overlap);

  return cut.map((c, chunkIndex) => {
    const winningOffset = dominantHeadingOffset(headings, c.start, c.end, text.length);
    const { heading, headingPath } = resolveHeadingPath(headings, winningOffset);
    let embeddingText;
    if (title && headingPath) {
      embeddingText = `${title}\nSeção: ${headingPath}\n\n${c.text}`;
    } else if (title) {
      embeddingText = `${title}\n\n${c.text}`;
    } else {
      embeddingText = c.text;
    }
    return { path, title, heading, headingPath, chunkIndex, text: c.text, embeddingText };
  });
}
