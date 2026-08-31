// Constrói o Markdown de captura bruta de uma conversa, no formato que o
// vault jarvis-os-vault espera em 00-Inbox/ (ver Principle — Knowledge
// Lifecycle: Capture é o primeiro estágio do pipeline, ainda sem domain,
// hub ou aliases atribuídos — isso fica para o triage manual do operador).

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateTime(d) {
  return `${formatDate(d)} ${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// Notas em 00-Inbox/ ainda não passaram pelo triage humano — qualquer `[[`/`]]`
// literal digitado na conversa é escapado para não virar link (e possível nó
// fantasma) no grafo do Vault Brain antes da hora.
function escapeWikilinks(text) {
  return text.replace(/\[\[/g, '\\[\\[').replace(/\]\]/g, '\\]\\]');
}

function extractTurnText(turn) {
  if (typeof turn.content === 'string') return turn.content.trim();
  if (typeof turn.text === 'string') return turn.text.trim();
  if (Array.isArray(turn.lines)) return turn.lines.join('\n').trim();
  return '';
}

export function buildCaptureFilename(startedAt) {
  return `Capture ${formatDateTime(startedAt)}.md`;
}

// Qual fatia do histórico a próxima gravação cobre. Pura de propósito: é aqui
// que mora a regra que impede reescrever conversa já registrada — a que deixava
// o 00-Inbox acumular a mesma conversa a cada reload.
//
// `base` é o primeiro turno que pertence à nota atual. Igual ao tamanho do
// histórico significa "tudo que existe já foi registrado" → não grava. Maior
// que o tamanho só acontece quando o corte de 60 turnos do localStorage tornou
// o índice obsoleto; aí zera, porque repetir turnos é melhor que parar de
// capturar em silêncio.
export function resolveCaptureSlice(base, historyLength) {
  const safe = base > historyLength ? 0 : base;
  return { base: safe, skip: historyLength - safe === 0 };
}

// Assinatura de conteúdo da captura. A gravação é idempotente por CONTEÚDO, não
// por tempo: o efeito de captura dispara sempre que há histórico, e o histórico
// é restaurado do localStorage a cada reload — sem esta comparação, abrir o app
// sem dizer nada de novo reescrevia a conversa inteira num arquivo novo.
//
// Cobre só os turnos. Ignora de propósito o frontmatter (`created`/`updated`
// viram outro dia sem que a conversa mude) e o heading (carrega o `startedAt`):
// se qualquer um dos dois entrasse na conta, um reload que recarimbasse o
// horário pareceria conteúdo novo e gravaria outro arquivo — que é exatamente o
// que estamos corrigindo. Só os turnos definem se há algo novo a gravar.
export function captureSignature(markdown) {
  const end = markdown.indexOf('\n---\n');
  const afterFrontmatter = end === -1 ? markdown : markdown.slice(end + 5);
  const body = afterFrontmatter.replace(/^\s*#[^\n]*\n/, '');
  // djb2: determinístico, sem dependência e estável entre sessões (o índice
  // persiste no localStorage). Colisão aqui só custaria uma gravação a menos
  // numa conversa que mudou — e o próximo turno já corrige.
  let h = 5381;
  for (let i = 0; i < body.length; i++) h = ((h << 5) + h + body.charCodeAt(i)) | 0;
  return `${body.length}:${(h >>> 0).toString(36)}`;
}

export function buildCaptureMarkdown({ startedAt, turns }) {
  const today = formatDate(new Date());
  const frontmatter = [
    '---',
    'type: atomic',
    'status: seed',
    'domain:',
    `created: ${today}`,
    `updated: ${today}`,
    'importance: low',
    'aliases: []',
    '---',
  ].join('\n');

  const heading = `# Jarvis Chat — ${formatDateTime(startedAt)}`;

  const body = turns
    .filter(t => t.role === 'operator' || t.role === 'jarvis')
    .map(t => {
      const text = extractTurnText(t);
      if (!text) return null;
      const who = t.role === 'operator' ? 'Operador' : 'Jarvis';
      return `**${who}:** ${escapeWikilinks(text)}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return `${frontmatter}\n\n${heading}\n\n${body}\n`;
}
